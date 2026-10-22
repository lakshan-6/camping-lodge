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

const nav = [
  ['/', 'Dashboard'], ['/inventory', 'Inventory'], ['/availability', 'Check Availability'],
  ['/orders', 'Orders'], ['/rentals', 'Rentals'], ['/returns', 'Returns'], ['/customers', 'Customers'],
  ['/calendar', 'Calendar'], ['/billing', 'Billing'], ['/payments', 'Payments'],
  ['/reports', 'Reports'], ['/settings', 'Settings'], ['/staff', 'Staff Access'],
];
const adminOnly = ['/reports', '/settings', '/staff'];

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!getToken());
  const [st, setSt] = useState({ businessName: 'Camping Lodge', phone: '' });
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    if (getToken()) api('/auth/me').then(setUser).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);
  useEffect(() => { if (user) api('/settings').then(setSt).catch(() => {}); }, [user]);

  if (!ready) return null;
  if (!user) return <Login onLogin={setUser} />;
  const admin = user.role === 'admin';
  const pages = { '/': <Dashboard />, '/inventory': <Inventory />, '/availability': <Availability />, '/orders': <Orders />,
    '/rentals': <Rentals />, '/returns': <Returns />, '/customers': <Customers />, '/calendar': <Calendar />,
    '/billing': <Billing />, '/payments': <Payments />, '/reports': <Reports />, '/settings': <Settings onSaved={setSt} />, '/staff': <Staff me={user} /> };
  const items = nav.filter(([to]) => admin || !adminOnly.includes(to));
  const title = (nav.find(n => n[0] === pathname) || nav[0])[1];
  const logout = () => { setToken(null); location.reload(); };

  return (
    <div className="shell">
      <aside className={open ? 'side open' : 'side'}>
        <div className="brand">{st.businessName}<small>{st.phone}</small></div>
        <nav onClick={() => setOpen(false)}>
          {items.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>)}
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
