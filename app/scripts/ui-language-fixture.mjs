// Existing bilingual component fixtures explicitly request Auto; product defaults are tested separately.
Object.defineProperty(globalThis,'localStorage',{configurable:true,writable:true,value:{getItem:key=>key==='musely.ui.language'?'auto':null,setItem(){}}});
