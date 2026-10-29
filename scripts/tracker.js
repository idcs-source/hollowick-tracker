const ID = 'hollowick-tracker';
const CHANNEL = `module.${ID}`;
const DEFAULTS = { happiness: 3, candy: 0, visible: false };
let tracker;
let currentVisible = false;
let togglePending = false;

function state() {
  return { happiness: game.settings.get(ID, 'happiness'), candy: game.settings.get(ID, 'candy') };
}

// Update the current UI in place. Recreating the entire Foundry application
// on each point adjustment was significantly more expensive.
function refresh() {
  const root = tracker?.element?.querySelector('.hollowick-root');
  if (!root) return;
  const values = state();
  for (const [key, max] of [['happiness', 6], ['candy', 15]]) {
    const label = root.querySelector(`[data-value="${key}"]`);
    if (label) label.textContent = `${values[key]} / ${max}`;
    root.querySelectorAll(`[data-meter="${key}"] .hollowick-segment`).forEach((segment, i) => {
      segment.classList.toggle('filled', i < values[key]);
    });
  }
}

function updateToggle() {
  // v13/v14 scene-control toolbar buttons are maintained by Foundry.
  // Synchronize the DOM state without re-rendering that entire toolbar.
  document.querySelectorAll('[data-tool="hollowickToggle"], [data-tool="hollowick-toggle"]').forEach(button => {
    button.classList.toggle('active', currentVisible);
    button.setAttribute('aria-pressed', String(currentVisible));
    button.title = currentVisible ? 'Hide Hollowick tracker for everyone' : 'Show Hollowick tracker for everyone';
  });
}

function syncVisibility(visible) {
  const desired = Boolean(visible);
  // Avoid repeated render/close calls caused by socket + settings onChange.
  if (desired === currentVisible && ((desired && tracker?.rendered) || (!desired && !tracker?.rendered))) {
    updateToggle();
    return;
  }
  currentVisible = desired;
  if (desired) {
    if (!tracker?.rendered) void tracker?.render({force:true});
  } else if (tracker?.rendered) {
    void tracker.close();
  }
  updateToggle();
}

class HollowickWindow extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: 'hollowick-festival-window',
    classes: ['hollowick-window'],
    window: {frame:false, resizable:false},
    position: {width:768,height:282}
  };
  async _renderHTML() {
    const root = document.createElement('div');
    root.className = 'hollowick-root';
    root.innerHTML = `<div class="hollowick-banner">HOLLOWICK FESTIVAL</div>
      <section class="hollowick-section happiness"><div class="hollowick-heading">HOLLOWICK HAPPINESS <span data-value="happiness"></span></div><div class="hollowick-meter" data-meter="happiness"></div><div class="hollowick-controls" data-controls="happiness"></div></section>
      <section class="hollowick-section candy"><div class="hollowick-heading">CANDY HANDFULS <span data-value="candy"></span></div><div class="hollowick-meter" data-meter="candy"></div><div class="hollowick-controls" data-controls="candy"></div></section>
      ${game.user.isGM ? '<button type="button" class="hollowick-close" title="Hide for everyone" aria-label="Hide for everyone">×</button>' : ''}`;
    const values=state();
    for (const [key,max] of [['happiness',6],['candy',15]]) {
      root.querySelector(`[data-value="${key}"]`).textContent=`${values[key]} / ${max}`;
      const meter=root.querySelector(`[data-meter="${key}"]`);
      for(let i=0;i<max;i++) {
        const segment=document.createElement('span');
        segment.className=`hollowick-segment ${i<values[key]?'filled':''}`;
        meter.append(segment);
      }
      if(game.user.isGM) root.querySelector(`[data-controls="${key}"]`).innerHTML=`<button type="button" data-key="${key}" data-delta="-1">−</button><button type="button" data-key="${key}" data-delta="1">+</button>`;
    }
    return root;
  }
  _replaceHTML(result,content) {
    content.replaceChildren(result);
    content.querySelectorAll('[data-key]').forEach(button=>button.addEventListener('click',async()=>{
      if(!game.user.isGM)return;
      const key=button.dataset.key,max=key==='happiness'?6:15;
      const next=Math.max(0,Math.min(max,Number(game.settings.get(ID,key))+Number(button.dataset.delta)));
      await game.settings.set(ID,key,next);
    }));
    content.querySelector('.hollowick-close')?.addEventListener('click',()=>game.hollowickTracker.hide());
  }
}

Hooks.once('init',()=>{
  for(const [key,initial] of Object.entries(DEFAULTS)) game.settings.register(ID,key,{
    name:key,scope:'world',config:false,type:typeof initial==='boolean'?Boolean:Number,default:initial,
    onChange:value=>{if(key==='visible')syncVisibility(value);else refresh();}
  });
});

// Proper native Token Controls tool, only registered for the GM.
// Foundry v13/v14 uses controls.tokens.tools. Older control collection shapes
// are handled as a fallback to be resilient across system releases.
Hooks.on('getSceneControlButtons', controls => {
  if (!game.user?.isGM) return;
  const tokenControl = Array.isArray(controls)
    ? controls.find(c => c.name === 'tokens' || c.name === 'token')
    : (controls.tokens ?? controls.token);
  if (!tokenControl) return;
  const tool = {
    name: 'hollowickToggle',
    title: 'Show / Hide Hollowick Festival Tracker (all players)',
    icon: 'fas fa-mask',
    button: true,
    toggle: true,
    active: currentVisible,
    visible: true,
    onChange: () => game.hollowickTracker?.toggle(),
    onClick: () => game.hollowickTracker?.toggle()
  };
  if (Array.isArray(tokenControl.tools)) {
    if (!tokenControl.tools.some(t => t.name === tool.name)) tokenControl.tools.push(tool);
  } else if (tokenControl.tools && typeof tokenControl.tools === 'object') {
    tokenControl.tools[tool.name] = tool;
  }
});

async function changeVisibility(visible) {
  if (!game.user?.isGM || togglePending) return;
  const value = Boolean(visible);
  if (value === currentVisible) return;
  togglePending = true;
  // Give instant local feedback and notify peers before waiting on persistence.
  syncVisibility(value);
  game.socket.emit(CHANNEL, {type:'visibility',visible:value});
  try {
    await game.settings.set(ID,'visible',value);
  } catch (error) {
    console.error('Hollowick tracker: failed to save visibility', error);
    syncVisibility(game.settings.get(ID,'visible'));
    ui.notifications.error('Hollowick tracker: could not save visibility');
  } finally { togglePending = false; }
}

Hooks.once('ready',()=>{
  tracker = new HollowickWindow();
  currentVisible = false;
  game.hollowickTracker = {
    show:()=>changeVisibility(true),
    hide:()=>changeVisibility(false),
    toggle:()=>changeVisibility(!currentVisible),
    reset:async()=>{if(!game.user.isGM)return;for(const [key,value] of Object.entries(DEFAULTS))if(key!=='visible')await game.settings.set(ID,key,value);}
  };
  game.socket.on(CHANNEL,message=>{
    if(message?.type==='visibility')syncVisibility(message.visible);
    else if(message?.type==='refresh')refresh();
  });
  syncVisibility(game.settings.get(ID,'visible'));
  // Token controls are built before or after ready depending on the release.
  // Request a refresh so the new GM-only tool is present immediately.
  if(game.user.isGM) {
    try { ui.controls?.render({force:true}); } catch (error) { console.warn('Hollowick tracker: controls refresh failed',error); }
  }
});
