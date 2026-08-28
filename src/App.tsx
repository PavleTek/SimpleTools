import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import Home from './pages/Home';
import MdToPdf from './pages/MdToPdf';
import BarcodeCleaner from './pages/BarcodeCleaner';
import QrFromUrl from './pages/QrFromUrl';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/scan" element={<BarcodeCleaner />} />
        <Route path="/scan/:format" element={<BarcodeCleaner />} />
        <Route path="/scan/:format/:read" element={<BarcodeCleaner />} />
        <Route path="/barcode-cleaner" element={<Navigate to="/scan" replace />} />
        <Route path="/md-to-pdf" element={<MdToPdf />} />
        <Route path="/qr" element={<QrFromUrl />} />
        <Route path="/qr-from-url" element={<Navigate to="/qr" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
