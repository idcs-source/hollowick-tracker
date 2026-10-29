const ID = 'hollowick-tracker';
const CHANNEL = `module.${ID}`;
const DEFAULTS = { happiness: 3, candy: 0, visible: false };
let tracker;

function state() {
  return { happiness: game.settings.get(ID, 'happiness'), candy: game.settings.get(ID, 'candy') };
}
function refresh() { if (tracker?.rendered) tracker.render({force:true}); }
function syncVisibility(visible) {
  if (visible) tracker.render({force:true});
  else if (tracker?.rendered) tracker.close();
  updateToggle();
}
function updateToggle() {
  const btn = document.getElementById('hollowick-gm-toggle');
  if (btn) {
    const shown = game.settings.get(ID, 'visible');
    btn.classList.toggle('active', shown);
    btn.title = shown ? 'Hide Hollowick tracker from everyone' : 'Show Hollowick tracker to everyone';
    btn.setAttribute('aria-pressed', String(shown));
  }
}
class HollowickWindow extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: 'hollowick-festival-window', classes: ['hollowick-window'],
    window: {frame:false, resizable:false}, position:{width:768,height:282}
  };
  async _renderHTML() {
    const root=document.createElement('div'); root.className='hollowick-root';
    root.innerHTML=`<div class="hollowick-banner">HOLLOWICK FESTIVAL</div>
      <section class="hollowick-section happiness"><div class="hollowick-heading">HOLLOWICK HAPPINESS <span data-value="happiness"></span></div><div class="hollowick-meter" data-meter="happiness"></div><div class="hollowick-controls" data-controls="happiness"></div></section>
      <section class="hollowick-section candy"><div class="hollowick-heading">CANDY HANDFULS <span data-value="candy"></span></div><div class="hollowick-meter" data-meter="candy"></div><div class="hollowick-controls" data-controls="candy"></div></section>
      ${game.user.isGM ? '<button type="button" class="hollowick-close" title="Hide for everyone" aria-label="Hide for everyone">×</button>' : ''}`;
    const values=state();
    for (const [key,max] of [['happiness',6],['candy',15]]) {
      root.querySelector(`[data-value="${key}"]`).textContent=`${values[key]} / ${max}`;
      const meter=root.querySelector(`[data-meter="${key}"]`);
      for(let i=0;i<max;i++){const segment=document.createElement('span');segment.className=`hollowick-segment ${i<values[key]?'filled':''}`;meter.append(segment);}
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
Hooks.once('ready',()=>{
  tracker=new HollowickWindow();
  game.hollowickTracker={
    show:async()=>{if(!game.user.isGM)return;await game.settings.set(ID,'visible',true);game.socket.emit(CHANNEL,{type:'visibility',visible:true});syncVisibility(true);},
    hide:async()=>{if(!game.user.isGM)return;await game.settings.set(ID,'visible',false);game.socket.emit(CHANNEL,{type:'visibility',visible:false});syncVisibility(false);},
    toggle:async()=>game.settings.get(ID,'visible')?game.hollowickTracker.hide():game.hollowickTracker.show(),
    reset:async()=>{if(!game.user.isGM)return;for(const [key,value] of Object.entries(DEFAULTS))if(key!=='visible')await game.settings.set(ID,key,value);}
  };
  game.socket.on(CHANNEL,message=>{if(message?.type==='visibility')syncVisibility(message.visible);else if(message?.type==='refresh')refresh();});
  if(game.settings.get(ID,'visible'))syncVisibility(true);
  if(game.user.isGM){
    const btn=document.createElement('button');btn.id='hollowick-gm-toggle';btn.type='button';btn.textContent='🎃';btn.title='Toggle Hollowick tracker for everyone';
    btn.addEventListener('click',()=>game.hollowickTracker.toggle());document.body.append(btn);updateToggle();
  }
});
