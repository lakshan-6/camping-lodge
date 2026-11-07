import { useEffect, useState } from 'react';
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
import Payments from './pages/Payments.jsx';
import Billing from './pages/Billing.jsx';
import Calendar from './pages/Calendar.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import Staff from './pages/Staff.jsx';
import Today from './pages/Today.jsx';
import Repairs from './pages/Repairs.jsx';
import {Expenses,Activity,Backups} from './pages/Management.jsx';
import {can} from './permissions.js';

const nav = [
  ['/', 'Dashboard'], ['/inventory', 'Inventory'], ['/availability', 'Check Availability'],
  ['/orders', 'Orders'], ['/rentals', 'Rentals'], ['/returns', 'Returns'], ['/customers', 'Customers'],
  ['/calendar', 'Calendar'], ['/billing', 'Billing'], ['/payments', 'Payments'],
  ['/reports', 'Reports'], ['/settings', 'Settings'], ['/staff', 'Staff Access'],
  ['/today','Today’s work'], ['/repairs','Repairs'], ['/expenses','Expenses'], ['/activity','Activity history'], ['/backups','Backups'],
];
const adminOnly = ['/reports', '/settings', '/staff'];

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!getToken());
  const [st, setSt] = useState({ businessName: 'Camping Lodge', phone: '' });
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(0);
  const { pathname } = useLocation();

  useEffect(() => {
    if (getToken()) api('/auth/me').then(setUser).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);
  useEffect(() => { if (user) api('/settings').then(setSt).catch(() => {}); }, [user]);

  useEffect(() => {
    if (!user) return;
    const isAdmin = ['owner', 'admin'].includes(user.role);
    const tick = () => { api('/auth/me').catch(() => {}); if (isAdmin) api('/users/online').then(d => setOnline(d.count)).catch(() => {}); };
    tick(); const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, [user]);

  if (!ready) return null;
  if (!user) return <Login onLogin={setUser} />;
  const admin = ['owner', 'admin'].includes(user.role);
  const pages = { '/': <Dashboard me={user}/>, '/inventory': <Inventory me={user}/>, '/availability': <Availability />, '/orders': <Orders me={user} />,
    '/rentals': <Rentals me={user}/>, '/returns': <Returns me={user}/>, '/customers': <Customers me={user}/>, '/calendar': <Calendar />,
    '/billing': <Billing me={user}/>, '/payments': <Payments me={user}/>, '/reports': <Reports />, '/settings': <Settings onSaved={setSt} />, '/staff': <Staff me={user} />,
    '/today':<Today/>, '/repairs':<Repairs me={user}/>, '/expenses':<Expenses/>, '/activity':<Activity/>, '/backups':<Backups/> };
  const items = nav.filter(([to]) => {
    if(['/activity','/backups'].includes(to))return user.role==='owner';
    if(to==='/repairs')return can(user,'inventory.manage');
    if(to==='/expenses')return can(user,'expenses.manage');
    if(to==='/reports')return can(user,'reports.view');
    if(to==='/payments')return can(user,'finance.view')||can(user,'payments.record')||can(user,'payments.refund');
    return admin||!adminOnly.includes(to);
  });
  const title = (nav.find(n => n[0] === pathname) || nav[0])[1];
  const logout = async () => { try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ } setToken(null); location.reload(); };

  return (
    <div className="shell">
      <aside className={open ? 'side open' : 'side'}>
        <div className="brand"><img src="/logo.png" alt="" className="logo" />{st.businessName}<small>{st.phone}</small></div>
        <nav onClick={() => setOpen(false)}>
          {items.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}>{label}
            {to === '/staff' && <span className="online" title="People online now"><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6z" /></svg>{online}</span>}</NavLink>)}
        </nav>
        <div className="who">{user.name}<small>{user.role}</small><button onClick={logout}>Log out</button></div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="top">
          <button className="menu" onClick={() => setOpen(true)} aria-label="Open menu">☰</button>
          <h1>{title}</h1>
        </header>
        <main className="page">
          <Routes>
            {items.map(([to]) => <Route key={to} path={to} element={pages[to]} />)}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
