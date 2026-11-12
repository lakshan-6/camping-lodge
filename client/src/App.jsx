import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, getToken, setToken } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Inventory from './pages/Inventory.jsx';
import Customers from './pages/Customers.jsx';
import Availability from './pages/Availability.jsx';
import Orders from './pages/Orders.jsx';
import Rentals from './pages/Rentals.jsx';
import Returns from './pages/Returns.jsx';
import Money from './pages/Money.jsx';
import Calendar from './pages/Calendar.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import Staff from './pages/Staff.jsx';
import Today from './pages/Today.jsx';
import Repairs from './pages/Repairs.jsx';
import {Expenses,Activity} from './pages/Management.jsx';
import Backups from './pages/Backups.jsx';
import {can} from './permissions.js';
import {StockCounts} from './pages/Reconciliation.jsx';
import AccountSecurity from './pages/AccountSecurity.jsx';
import Icon from './components/Icon.jsx';
import {PageIntro} from './components/UI.jsx';
import useModalAccessibility from './components/useModalAccessibility.js';

const nav = [
  ['/', 'Today’s work','home','Overview'], ['/dashboard', 'Business overview','chart','Overview'], ['/calendar', 'Calendar','calendar','Overview'],
  ['/orders', 'Orders','orders','Rental desk'], ['/availability', 'Check Availability','search','Rental desk'], ['/rentals', 'Rentals','pickup','Rental desk'], ['/returns', 'Returns','returns','Rental desk'], ['/customers', 'Customers','users','Rental desk'],
  ['/inventory', 'Inventory','box','Equipment'], ['/stock-counts','Stock count','clipboard','Equipment'], ['/repairs','Repairs','repair','Equipment'],
  ['/money', 'Money / මුදල්','wallet','Finance'], ['/expenses','Expenses','receipt','Finance'], ['/reports', 'Reports','report','Finance'],
  ['/staff', 'Staff Access','users','Management'], ['/settings', 'Settings','settings','Management'], ['/orders/maintenance','Order maintenance','orders','Management'], ['/activity','Activity history','activity','Management'], ['/backups','Backups','backup','Management'], ['/security','Account security','shield','Management'],
];
const adminOnly = ['/dashboard','/reports', '/settings', '/staff'];
const mainNavigation=['/','/orders','/inventory','/money','/customers'];
const intros={
 '/availability':['Plan ahead','Find the right gear, at the right time.','Choose pickup and return times to see what is available for your next booking.'],
 '/rentals':['Handover & tracking','Ready for the road.','Manage upcoming pickups, equipment with customers and rental extensions.'],
 '/returns':['Equipment coming home','A smooth return, every time.','Receive equipment, record its condition and settle any remaining charges.'],
 '/calendar':['Your rental schedule','Make room for the next adventure.','Select a day to see bookings and plan equipment handovers.'],
 '/stock-counts':['Equipment control','Keep your stock in step.','Compare the equipment in your store with the system and record any differences.'],
 '/repairs':['Equipment care','Good gear deserves good care.','Track repairs and get equipment back into your available stock.'],
 '/expenses':['Business spending','Keep the small costs in sight.','Record spending and review the expenses behind your day-to-day operations.'],
 '/staff':['Team & permissions','The right access for your team.','Manage staff accounts and choose what each person can do.'],
 '/settings':['Your business','Make it your lodge.','Keep your business details and rental policies up to date.'],
 '/activity':['Business activity','Know what changed, and when.','Review recent changes to your records and the people who made them.'],
 '/backups':['Data & recovery','Keep a copy. Keep peace of mind.','Create encrypted snapshots and keep recovery copies in a separate, safe place.'],
 '/security':['Your account','A little protection goes a long way.','Manage your password, authenticator and recovery options.'],
};

export default function App() {
  useModalAccessibility();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!getToken());
  const [st, setSt] = useState({ businessName: 'Camping Lodge', phone: '' });
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(0);
  const navRef = useRef(null);
  const { pathname } = useLocation();

  useEffect(() => {
    if (getToken()) api('/auth/me').then(setUser).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);
  useEffect(() => { if (user) api('/settings').then(setSt).catch(() => {}); }, [user]);
  useEffect(()=>{setOpen(false);},[pathname]);
  useEffect(()=>{
    if(!open)return;
    const previous=document.activeElement,overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const focusFrame=requestAnimationFrame(()=>navRef.current?.querySelector('button')?.focus({preventScroll:true}));
    const keydown=e=>{
      if(e.key==='Escape'){e.preventDefault();setOpen(false);}
      if(e.key==='Tab'){
        const targets=[...navRef.current.querySelectorAll('a[href],button:not([disabled]),summary')].filter(el=>el.getClientRects().length),first=targets[0],last=targets.at(-1);
        if(!navRef.current.contains(document.activeElement)){e.preventDefault();(e.shiftKey?last:first)?.focus();}
        else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
    };
    const resized=()=>{if(window.innerWidth>980)setOpen(false);};
    document.addEventListener('keydown',keydown);window.addEventListener('resize',resized);
    return()=>{cancelAnimationFrame(focusFrame);document.body.style.overflow=overflow;document.removeEventListener('keydown',keydown);window.removeEventListener('resize',resized);if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[open]);

  useEffect(() => {
    if (!user) return;
    const isAdmin = ['owner', 'admin'].includes(user.role);
    const tick = () => { api('/auth/me').catch(() => {}); if (isAdmin) api('/users/online').then(d => setOnline(d.count)).catch(() => {}); };
    tick(); const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, [user]);

  if (!ready) return <div className="app-loading" role="status"><Icon name="tent" size={36}/><p>Opening Camping Lodge…</p></div>;
  if (!user) return <Login onLogin={setUser} />;
  const admin = ['owner', 'admin'].includes(user.role);
  const pages = { '/': <Today me={user}/>, '/dashboard': <Dashboard me={user}/>, '/inventory': <Inventory me={user}/>, '/stock-counts':<StockCounts/>, '/availability': <Availability me={user}/>, '/orders': <Orders key="orders" me={user} />,
    '/orders/maintenance': <Orders key="order-maintenance" me={user} maintenance/>,
    '/rentals': <Rentals me={user}/>, '/returns': <Returns me={user}/>, '/customers': <Customers me={user}/>, '/calendar': <Calendar />,
    '/money': <Money me={user}/>, '/reports': <Reports />, '/settings': <Settings onSaved={setSt} />, '/staff': <Staff me={user} />,
    '/repairs':<Repairs me={user}/>, '/expenses':<Expenses/>, '/activity':<Activity/>, '/backups':<Backups/>, '/security':<AccountSecurity/> };
  const items = nav.filter(([to]) => {
    if(['/activity','/backups','/security','/orders/maintenance'].includes(to))return user.role==='owner';
    if(['/repairs','/stock-counts'].includes(to))return can(user,'inventory.manage');
    if(to==='/expenses')return can(user,'expenses.manage');
    if(to==='/reports')return can(user,'reports.view');
    if(to==='/payments')return can(user,'finance.view')||can(user,'payments.record')||can(user,'payments.refund');
    return admin||!adminOnly.includes(to);
  });
  const title = (nav.find(n => n[0] === pathname) || nav[0])[1];
  const current = nav.find(n=>n[0]===pathname)||nav[0];
  const initials=user.name.trim().split(/\s+/).slice(0,2).map(n=>n[0]).join('').toUpperCase();
  const date=new Intl.DateTimeFormat('en-LK',{timeZone:'Asia/Colombo',weekday:'short',day:'numeric',month:'short',year:'numeric'}).format(new Date());
  const logout = async () => { try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ } setToken(null); location.reload(); };
  const primaryItems=items.filter(([to])=>mainNavigation.includes(to));
  const moreItems=items.filter(([to])=>!mainNavigation.includes(to));
  const navLink=([to,label,icon])=><NavLink key={to} to={to} end onClick={()=>setOpen(false)}><Icon name={icon} size={19}/><span>{label}</span>{to==='/staff'&&<span className="online" title="People online now">{online}</span>}</NavLink>;

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside ref={navRef} className={open ? 'side open' : 'side'} aria-label="Main navigation" id="main-navigation">
        <div className="brand"><img src="/logo.png" alt="" className="logo"/><div>{st.businessName}<small>Rental management</small></div><button className="close-menu icon-button" onClick={()=>setOpen(false)} aria-label="Close menu"><Icon name="close"/></button></div>
        <nav aria-label="Workspace">
          <div className="nav-group">{primaryItems.map(navLink)}</div>
          <details className="nav-more" open={moreItems.some(([to])=>to===pathname)||undefined}>
            <summary>More tools</summary>
            {[...new Set(moreItems.map(n=>n[3]))].map(group=><div className="nav-group" key={group}><p className="nav-heading">{group}</p>{moreItems.filter(n=>n[3]===group).map(navLink)}</div>)}
          </details>
        </nav>
        <div className="who"><div className="profile"><span className="avatar">{initials}</span><div><strong>{user.name}</strong><small>{user.role}</small></div><button className="icon-button" onClick={logout} aria-label="Log out" title="Log out"><Icon name="logout"/></button></div>{st.phone&&<small className="business-phone">{st.phone}</small>}</div>
      </aside>
      {open && <button className="scrim" aria-label="Close navigation" tabIndex={-1} onClick={() => setOpen(false)} />}
      <div className="main" {...(open?{inert:''}:{})}>
        <header className="top">
          <button className="menu icon-button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} aria-controls="main-navigation"><Icon name="menu"/></button>
          <div className="top-title"><span className="top-icon"><Icon name={current[2]}/></span><div><p>{current[3]}</p><h1>{title}</h1></div></div>
          <div className="top-right"><time className="business-date"><Icon name="calendar" size={17}/>{date}</time><span className="avatar top-avatar" title={user.name+' · '+user.role}>{initials}</span></div>
        </header>
        <main className="page" id="main-content" tabIndex={-1}>
          {intros[pathname]&&<PageIntro eyebrow={intros[pathname][0]} title={intros[pathname][1]} description={intros[pathname][2]}/>}
          <Routes>
            <Route path="/today" element={<Navigate to="/" replace/>}/>
            <Route path="/billing" element={<Navigate to="/money" replace/>}/>
            <Route path="/payments" element={<Navigate to="/money?view=payments" replace/>}/>
            {items.map(([to]) => <Route key={to} path={to} element={pages[to]} />)}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <footer className="app-footer"><span>{st.businessName}</span><span>Made for your next adventure.</span></footer>
      </div>
      <nav className="mobile-nav" aria-label="Quick navigation" {...(open?{inert:''}:{})}>{items.filter(([to])=>['/','/orders','/inventory','/money'].includes(to)).map(([to,label,icon])=><NavLink key={to} to={to} end={to==='/'}><Icon name={icon}/><span>{to==='/'?'Today':to==='/money'?'Money':label}</span></NavLink>)}</nav>
    </div>
  );
}
