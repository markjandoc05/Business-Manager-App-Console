// Deterministic hook adapter executes component callbacks/effects without a DOM.
// It does not replace authenticated browser or Firebase subscription validation.
export function reactFixture() {
 const slots=[];const effects=[];let cursor=0;let element;
 const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
 const hooks={createContext:()=>({Provider:'Provider'}),createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'Fragment',useContext:()=>{},
  useState:initial=>{const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,next=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;}];},
  useRef:initial=>{const i=cursor++;if(!slots[i])slots[i]={value:{current:initial}};return slots[i].value;},
  useMemo:(fn,deps)=>{const i=cursor++;if(!slots[i]||!equal(slots[i].deps,deps))slots[i]={value:fn(),deps};return slots[i].value;},
  useCallback:(fn,deps)=>hooks.useMemo(()=>fn,deps),
  useEffect:(fn,deps)=>{const i=cursor++;if(!slots[i]||!equal(slots[i].deps,deps)){const previous=slots[i];slots[i]={deps};effects.push(()=>{previous?.cleanup?.();slots[i].cleanup=fn();});}},
 };
 hooks.default=hooks;
 return{hooks,render:(component,props={})=>{cursor=0;element=component(props);return element;},flush:()=>{while(effects.length)effects.shift()();},unmount:()=>{for(const slot of slots)slot?.cleanup?.();},element:()=>element};
}
