import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {templateVariableQuery} from './templateVariables.js';
import './variable-text-field.css';

/** Controlled text field: onChange receives the new string, including inserted variables. */
export default function VariableTextField({as:Control='input',variables=[],value='',onChange,onKeyDown,onSelect,onFocus,onBlur,onCompositionStart,onCompositionEnd,...props}) {
  const input=useRef(null),options=useRef(null),pendingCaret=useRef(null),composing=useRef(false);
  const [query,setQuery]=useState(null),[activeName,setActiveName]=useState(null),[position,setPosition]=useState(null);
  const menuId=useId();
  const matches=query && !props.disabled && !props.readOnly?variables.filter(({name})=>name.toLowerCase().startsWith(query.query.toLowerCase()) && (props.maxLength===undefined || String(value).length-(query.end-query.start)+name.length+2<=props.maxLength)):[];
  const active=Math.max(0,matches.findIndex(({name})=>name===activeName));
  const open=matches.length>0;
  function dismiss(){setQuery(null);setActiveName(null);}
  function inspect(node){
    if(composing.current || props.disabled || props.readOnly)return;
    setQuery(templateVariableQuery(node.value,node.selectionStart,node.selectionEnd));
    setActiveName(null);
  }
  function select(variable){
    const node=input.current;
    if(!node || !query)return;
    const token=`{${variable.name}}`,next=String(value).slice(0,query.start)+token+String(value).slice(query.end);
    if(props.maxLength!==undefined && next.length>props.maxLength)return;
    const caret=query.start+token.length;
    if(next===String(value)){
      node.setSelectionRange(caret,caret);
    }else{
      pendingCaret.current=caret;
      onChange(next);
    }
    dismiss();
  }
  useLayoutEffect(()=>{
    if(pendingCaret.current===null)return;
    const caret=pendingCaret.current;pendingCaret.current=null;
    input.current?.focus();input.current?.setSelectionRange(caret,caret);
    dismiss();
  },[value]);
  useLayoutEffect(()=>{
    if(!open)return;
    const update=()=>{
      const rect=input.current.getBoundingClientRect(),margin=8;
      const width=Math.min(Math.max(rect.width,280),window.innerWidth-2*margin);
      const anchorTop=Math.max(margin,Math.min(rect.top,window.innerHeight-margin));
      const anchorBottom=Math.max(margin,Math.min(rect.bottom,window.innerHeight-margin));
      const below=window.innerHeight-anchorBottom-margin;
      const above=anchorTop-margin;
      const upward=below<180 && above>below;
      const height=Math.min(280,Math.max(80,upward?above:below));
      setPosition({left:Math.max(margin,Math.min(rect.left,window.innerWidth-width-margin)),width,maxHeight:height,
        ...(upward?{bottom:window.innerHeight-anchorTop+4}:{top:anchorBottom+4})});
    };
    update();window.addEventListener('resize',update);window.addEventListener('scroll',update,true);
    return()=>{window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true);};
  },[open]);
  useEffect(()=>{options.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});},[activeName,open]);
  function keyDown(event){
    onKeyDown?.(event);
    if(event.defaultPrevented || event.nativeEvent.isComposing || composing.current || !open)return;
    if(event.key==='ArrowDown' || event.key==='ArrowUp'){
      event.preventDefault();setActiveName(matches[(active+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length].name);
    }else if((event.key==='Enter' || event.key==='Tab') && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey){
      event.preventDefault();select(matches[active]);
    }else if(event.key==='Escape'){
      event.preventDefault();event.stopPropagation();dismiss();
    }
  }
  return <>
    <Control {...props} autoComplete={props.autoComplete ?? 'off'} ref={input} value={value} onChange={event=>{onChange(event.currentTarget.value);inspect(event.currentTarget);}}
      onKeyDown={keyDown} onSelect={event=>{onSelect?.(event);inspect(event.currentTarget);}}
      onFocus={event=>{onFocus?.(event);inspect(event.currentTarget);}} onBlur={event=>{onBlur?.(event);dismiss();}}
      onCompositionStart={event=>{composing.current=true;dismiss();onCompositionStart?.(event);}}
      onCompositionEnd={event=>{composing.current=false;onCompositionEnd?.(event);inspect(event.currentTarget);}}
      role={Control==='input'?'combobox':undefined} aria-autocomplete="list" aria-controls={open?menuId:undefined} aria-expanded={Control==='input'?open:undefined} aria-haspopup="listbox"
      aria-activedescendant={open?`${menuId}-${matches[active].name}`:undefined}/>
    {open && position && createPortal(<div className="cr-variable-menu" style={position}>
      <div className="cr-variable-menu-heading">Available variables <span>↑ ↓ · Enter or Tab</span></div>
      <div ref={options} id={menuId} role="listbox" aria-label="Available variables" className="cr-variable-options">
        {matches.map((variable,index)=><div role="option" aria-selected={index===active} id={`${menuId}-${variable.name}`} key={variable.name}
          className="cr-variable-option" onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setActiveName(variable.name)} onClick={()=>select(variable)}>
          <code>{`{${variable.name}}`}</code><span>{variable.description}</span>
        </div>)}
      </div>
    </div>,document.body)}
  </>;
}
