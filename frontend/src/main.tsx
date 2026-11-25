import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import './index.css';
import AdminPage from './admin/AdminPage';
import ScenariosPage from './scenarios/ScenariosPage';
import StakeholderPage from './stakeholder/StakeholderPage';
import { wagmiConfig } from './wagmi';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/scenarios" element={<ScenariosPage />} />
            <Route path="/" element={<StakeholderPage />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
