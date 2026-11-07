import {Children,cloneElement,isValidElement} from 'react';
const text=node=>Children.toArray(node).map(child=>isValidElement(child)?text(child.props.children):String(child??'')).join('');
// Keep real table headings for assistive technology and print; label each mobile card field.
export default function ResponsiveTable({children,className='',emptyMessage='No records to display.',...props}){
 const sections=Children.toArray(children),head=sections.find(s=>s.type==='thead');
 const headerRow=Children.toArray(head?.props.children).find(r=>r.type==='tr');
 const labels=Children.toArray(headerRow?.props.children).map(c=>text(c.props.children));
 return <table {...props} role="table" className={'data-table '+className}>{sections.map(section=>{
  if(section.type==='thead')return cloneElement(section,{},Children.map(section.props.children,row=>isValidElement(row)?cloneElement(row,{},Children.map(row.props.children,cell=>isValidElement(cell)?cloneElement(cell,{scope:'col'}):cell)):row));
  if(section.type!=='tbody')return section;
  const rows=Children.toArray(section.props.children).filter(Boolean);
  return cloneElement(section,{},rows.length?rows.map(row=>!isValidElement(row)||row.type!=='tr'?row:cloneElement(row,{},Children.map(row.props.children,(cell,index)=>{
   if(!isValidElement(cell)||cell.type!=='td')return cell;
   const full=Number(cell.props.colSpan)>1,actions=!full&&!labels[index];
   return cloneElement(cell,{'data-l':full||actions?undefined:cell.props['data-l']||labels[index],'data-actions':actions||undefined,'data-full':full||undefined},<span className="cell-value">{cell.props.children}</span>);
  }))):<tr><td colSpan={labels.length||1} data-full="true"><div className="table-empty">{emptyMessage}</div></td></tr>);
 })}</table>;
}
