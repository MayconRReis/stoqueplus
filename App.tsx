
import React, { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react';
import Papa from 'papaparse';
import { disableSupabase, isFetchOrNetworkError } from './lib/supabase';
import { useNotifications } from './hooks/useNotifications';
import { useTheme } from './hooks/useTheme';
import { useAuth } from './hooks/useAuth';
import { useInventoryFilters, PAGE_SIZE } from './hooks/useInventoryFilters';
import { useHistoryFilters } from './hooks/useHistoryFilters';
import { usePalletSelection } from './hooks/usePalletSelection';
import { useShipments } from './hooks/useShipments';
import { useWarehouseData, generateSlots } from './hooks/useWarehouseData';
import { useVersionCheck } from './hooks/useVersionCheck';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LayoutDashboard, 
  Package, 
  ArrowLeftRight, 
  History, 
  FileUp, 
  ClipboardCheck, Bell, BellRing, BellOff,
  LogOut, 
  Menu, 
  X, 
  FlaskConical, 
  Warehouse, 
  Boxes, 
  CheckCircle2, 
  AlertCircle,
  HelpCircle,
  Share2,
  Download,
  ArrowRight,
  Truck,
  Search,
  Trash2,
  Info,
  Send,
  Plus,
  Loader2,
  Pencil,
  RefreshCw,
  Container,
  Filter,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  TrendingUp,
  Tag,
  Calendar,
  Layers,
  MapPin,
  Hash,
  Users,
  Sun,
  Moon,
  DatabaseBackup,
  UploadCloud
} from 'lucide-react';
import { 
  SheetRow, 
  StockStatus, 
  InspectionData, 
  DashboardStats, 
  WarehouseSlot, 
  SlotContent, 
  HistoryEntry, 
  HistoryType, 
  translateSlotContent,
  getContentTypeColor,
  Shipment,
  ShipmentType,
  ShipmentStatus,
  WarehouseDiagnostic,
  SHAREABLE_SLOT_TYPES,
  isPendingSlot
} from './types';
import { InventoryDetailModal } from './components/InventoryDetailModal';
import { InventoryBulkConfirmModal } from './components/InventoryBulkConfirmModal';
import { EditPalletModal } from './components/EditPalletModal';
import { ManualPalletModal } from "./components/ManualPalletModal";
import { MovementModal } from "./components/MovementModal";
import { ShipmentPage } from './components/ShipmentPage';
import { ShipmentModal } from './components/ShipmentModal';
import { ShipmentDetailModal } from './components/ShipmentDetailModal';
import { supabaseService, mapHistoryRow, clientSessionId } from './services/supabaseService';
import { OnlineOperatorsWidget } from './components/OnlineOperatorsWidget';
import {
  isBrowserNotificationSupported,
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  isBrowserNotificationsEnabled,
  setBrowserNotificationsEnabled,
  sendBrowserNotification,
  notifyShipmentCreated,
  notifyPendingApproval,
  notifyPendingAnalysis,
  notifyMovementDone
} from './utils/browserNotifications';
import { Login } from './components/Login';
import { UserManager } from './components/UserManager';
import ApprovalsPage from './components/ApprovalsPage';
import QuickSearch from './components/QuickSearch';


import { AnalysisPage } from './components/AnalysisPage';
import { RotativeStockManager } from './components/RotativeStockManager';
import { WaitingSlotsView } from './components/WaitingSlotsView';
import HistoryItem from './components/HistoryItem';
import StatsSection from './components/StatsSection';
import WarehouseMap from './components/WarehouseMap';
import RackDistributionChart from './components/RackDistributionChart';
import ProductDistributionChart from './components/ProductDistributionChart';
import InventoryCard from './components/InventoryCard';
import { ConsolidateDrawer } from './components/ConsolidateDrawer';
import { RecoveryModal } from './components/RecoveryModal';
import { BackupReminderModal } from './components/BackupReminderModal';
import { RestoreBackupModal } from './components/RestoreBackupModal';
import { User as AppUser } from './types';

const RECOVERY_DATA_MARKER = '__PALLET_RECOVERY_DATA__';

const hasRecoveryPayload = (details: string) => details.includes(RECOVERY_DATA_MARKER);

const stripRecoveryPayload = (details: string) => details.split(RECOVERY_DATA_MARKER)[0].trim();


const Logo: React.FC<{ size?: 'sm' | 'md' }> = ({ size = 'md' }) => {
  const isSm = size === 'sm';
  return (
    <div className="flex items-center gap-2">
      <div className={`${isSm ? 'w-8 h-8' : 'w-10 h-10'} bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20`}>
        <Warehouse className={`${isSm ? 'w-5 h-5' : 'w-6 h-6'} text-slate-900 dark:text-white`} />
      </div>
      <div>
        <h1 className={`${isSm ? 'text-lg' : 'text-2xl'} font-black tracking-tighter text-slate-900 dark:text-white flex items-center leading-none`}>
          Stoque<span className="text-blue-500">+</span>
        </h1>
        {!isSm && <p className="text-[8px] text-slate-600 dark:text-slate-500 font-bold uppercase tracking-[0.2em] mt-0.5">Ybera Paris</p>}
      </div>
    </div>
  );
};

const NavItem = memo(({ tab, icon: Icon, label, badge, isActive, onNavigate, activeTab, isCollapsed }: { tab: string, icon: React.ElementType, label: string, badge?: number, isActive: boolean, onNavigate: (tab: any) => void, activeTab: string, isCollapsed?: boolean }) => (
  // Nota sobre isCollapsed: esta mesma lista de NavItem é usada tanto no drawer mobile quanto
  // na sidebar fixa de desktop. Por isso o recolhimento (ícone-only) só se aplica com prefixo
  // "lg:" — no mobile o item continua sempre com o rótulo visível, independente de isCollapsed.
  <button
    onClick={() => onNavigate(tab)}
    title={isCollapsed ? label : undefined}
    className={`w-full flex items-center gap-3 py-3 rounded-xl transition-all relative group ${isCollapsed ? 'px-4 lg:px-0 lg:justify-center' : 'px-4'} ${isActive ? 'bg-blue-600 text-slate-900 dark:text-white shadow-lg shadow-blue-900/20' : 'hover:bg-slate-200 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:text-slate-200'}`}
  >
    <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-500 group-hover:text-slate-700 dark:text-slate-300'}`} />
    <span className={`font-semibold text-sm ${isCollapsed ? 'lg:hidden' : ''}`}>{label}</span>
    {badge ? (
      <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-50 dark:bg-slate-950 text-blue-400 border border-blue-900/30 ${isCollapsed ? 'lg:hidden' : ''}`}>
        {badge}
      </span>
    ) : null}
    {isActive && (
      <motion.div
        layoutId="activeTab"
        className={`absolute left-0 w-1 h-6 bg-white rounded-r-full ${isCollapsed ? 'lg:hidden' : ''}`}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      />
    )}
  </button>
));

const App: React.FC = () => {
  const { updateAvailable, reloadPage } = useVersionCheck();
  const { theme, setTheme } = useTheme();

  const [activeTab, setActiveTabInternal] = useState<'dashboard' | 'inventory' | 'map' | 'history' | 'analysis' | 'shipments' | 'rotative' | 'waiting' | 'users' | 'approvals' | 'quicksearch'>('dashboard');
  const [isPending, startTransition] = React.useTransition();
  
  const setActiveTab = useCallback((tab: typeof activeTab) => {
    const start = performance.now();
    startTransition(() => {
      setActiveTabInternal(tab);
      const end = performance.now();
      console.log(`[Performance] Tab switch to ${tab} initiated in ${(end - start).toFixed(2)}ms`);
    });
  }, []);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // Sidebar recolhível (somente desktop/lg): mantém só os ícones visíveis, mas os botões
  // continuam clicáveis e navegáveis. Preferência persistida para lembrar entre sessões.
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('stoque_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('stoque_sidebar_collapsed', isSidebarCollapsed ? '1' : '0');
    } catch {
      // localStorage indisponível (modo privado etc.) — apenas ignora a persistência
    }
  }, [isSidebarCollapsed]);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  // Lembrete diário de backup (08:00): mostra modal pedindo para baixar um JSON
  // com todos os dados do sistema. Reaparece no próximo login se for fechado sem baixar.
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isBackupDownloading, setIsBackupDownloading] = useState(false);
  const backupModalCheckedRef = useRef(false);
  const [isRestoreBackupModalOpen, setIsRestoreBackupModalOpen] = useState(false);

  const [isManualAddModalOpen, setIsManualAddModalOpen] = useState(false);
  const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);
  
  const [movementInitialContext, setMovementInitialContext] = useState<{
    type: 'entry' | 'transfer' | 'exit';
    id?: string;
    pallet?: SheetRow | null;
  } | null>(null);
  
  // Selection and Search State


  const [deleteContext, setDeleteContext] = useState<{ type: 'row' | 'pallet', rowId: string, palletIdx?: number } | null>(null);
  const [matrixConfirmContext, setMatrixConfirmContext] = useState<{ rowId: string, palletIdx: number, slotId?: string } | null>(null);
  const { notifications, setNotifications, showNotification } = useNotifications();
  const setDataRef = React.useRef<any>(null);
  const handleSetData = React.useCallback((val: any) => setDataRef.current?.(val), []);
  const { user, setUser, isAuthLoading, isPublicView, setIsPublicView } = useAuth(showNotification);
  const {
    inventorySearch, setInventorySearch,
    inventoryTypeFilter, setInventoryTypeFilter,
    isInventoryFilterOpen, setIsInventoryFilterOpen,
    inventoryPage, setInventoryPage,
    hasMoreInventory, setHasMoreInventory,
    isLoadingMore, setIsLoadingMore,
    loadMoreInventory
  } = useInventoryFilters(user, isPublicView, showNotification, handleSetData);
  const {
    history, setHistory,
    historySearch, setHistorySearch,
    historyPage, setHistoryPage,
    hasMoreHistory, setHasMoreHistory,
    isLoadingMoreHistory, isSearchingHistory,
    loadHistory,
    loadMoreHistory: loadMoreHistoryEntries,
    HISTORY_PAGE_SIZE
  } = useHistoryFilters(user, isPublicView, showNotification);
  const {
    selectedPallets, setSelectedPallets,
    isConsolidateDrawerOpen, setIsConsolidateDrawerOpen,
    isBulkConfirmOpen, setIsBulkConfirmOpen,
    selectedPalletsData, setSelectedPalletsData
  } = usePalletSelection(showNotification);
  const {
    shipments, setShipments,
    isShipmentModalOpen, setIsShipmentModalOpen,
    shipmentCounts, setShipmentCounts,
    shipmentDetailContext, setShipmentDetailContext,
    shipmentDetailPallets, setShipmentDetailPallets,
    isDetailLoading, setIsDetailLoading,
    fetchShipmentDetailPallets,
    handleOpenShipmentDetail
  } = useShipments(history, showNotification);
  const {
    data, setData,
    pendingRows, setPendingRows,
    waitingRows, setWaitingRows,
    pendingApprovalsCount, setPendingApprovalsCount,
    stats, setStats,
    warehouseDiagnostic, setWarehouseDiagnostic,
    isDiagnosticDetailsOpen, setIsDiagnosticDetailsOpen,
    slots, setSlots,
    refreshCombinedData
  } = useWarehouseData(
    inventoryPage,
    PAGE_SIZE,
    inventorySearch,
    inventoryTypeFilter,
    setHasMoreInventory,
    setShipmentCounts,
    showNotification
  );
  
  React.useEffect(() => {
    setDataRef.current = setData;
  }, [setData]);

  // Browser Notifications State & Handlers
  const [browserPerm, setBrowserPerm] = useState<NotificationPermission | 'unsupported'>(() => getBrowserNotificationPermission());
  const [isBrowserNotifActive, setIsBrowserNotifActive] = useState<boolean>(() => isBrowserNotificationsEnabled());

  const handleRequestBrowserPermission = useCallback(async () => {
    const perm = await requestBrowserNotificationPermission();
    setBrowserPerm(perm);
    if (perm === 'granted') {
      setIsBrowserNotifActive(true);
      setBrowserNotificationsEnabled(true);
      sendBrowserNotification({
        title: '🔔 Notificações Ativadas!',
        body: 'Você receberá avisos sobre novos carregamentos, aprovações, análises e movimentações mesmo com o navegador em segundo plano.',
        tag: 'stoque-welcome-test'
      });
      showNotification('Notificações no navegador ativadas com sucesso!');
    } else if (perm === 'denied') {
      setIsBrowserNotifActive(false);
      showNotification('Notificações bloqueadas pelo navegador. Habilite nas permissões do site.', 'info');
    }
  }, [showNotification]);

  const handleToggleBrowserNotif = useCallback((enabled: boolean) => {
    setBrowserNotificationsEnabled(enabled);
    setIsBrowserNotifActive(enabled);
    if (enabled && browserPerm !== 'granted') {
      handleRequestBrowserPermission();
    } else if (enabled) {
      showNotification('Notificações no navegador ativadas');
    } else {
      showNotification('Notificações no navegador desativadas', 'info');
    }
  }, [browserPerm, handleRequestBrowserPermission, showNotification]);

  const handleTestBrowserNotification = useCallback(() => {
    if (browserPerm !== 'granted') {
      handleRequestBrowserPermission();
      return;
    }
    sendBrowserNotification({
      title: '📦 Stoque+ Notificação Ativa',
      body: 'Teste realizado com sucesso! Você continuará sendo notificado em segundo plano.',
      tag: `test-${Date.now()}`
    });
  }, [browserPerm, handleRequestBrowserPermission]);

  // Multi-user Presence & Notification Deduplication
  const [onlineOperators, setOnlineOperators] = useState<Array<{ id?: string; name: string; role: string; email?: string; sessionId?: string }>>([]);

  useEffect(() => {
    if (user && !isPublicView) {
      setOnlineOperators(prev => {
        if (!prev.some(o => (user.id && o.id === user.id) || o.name === user.name)) {
          return [{ id: user.id, name: user.name, role: user.role, email: user.email, sessionId: clientSessionId }, ...prev];
        }
        return prev;
      });
    }
  }, [user, isPublicView]);
  const recentNotifKeysRef = useRef<Map<string, number>>(new Map());
  // Operações em lote (restaurar backup, finalizar carregamento) inserem/alteram muitas linhas de
  // uma vez, e cada uma delas dispara os canais realtime abaixo — sem essa trava, cada pallet ou
  // registro viraria uma notificação (toast + som) separada. Enquanto isso está "true", os canais
  // continuam atualizando o estado local normalmente, só não disparam notificação por item; quem
  // chamou a operação em lote mostra UMA notificação-resumo no final.
  const suppressRealtimeNotificationsRef = useRef(false);
  // Junta várias mudanças de carregamentos que chegam em rajada (ex.: dezenas de linhas mudando
  // de uma vez numa restauração de backup) numa única busca da lista completa, em vez de refazer
  // a busca inteira a cada linha alterada.
  const shipmentsRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldNotify = useCallback((key: string, cooldownMs = 5000): boolean => {
    if (suppressRealtimeNotificationsRef.current) return false;
    const now = Date.now();
    const last = recentNotifKeysRef.current.get(key);
    if (last && now - last < cooldownMs) return false;
    recentNotifKeysRef.current.set(key, now);
    if (recentNotifKeysRef.current.size > 120) {
      for (const [k, t] of recentNotifKeysRef.current.entries()) {
        if (now - t > 15000) recentNotifKeysRef.current.delete(k);
      }
    }
    return true;
  }, []);

  const [detailContext, setDetailContext] = useState<{ row: SheetRow, inspection: InspectionData, idx: number } | null>(null);
  const [editPalletContext, setEditPalletContext] = useState<{ row: SheetRow, inspection: InspectionData, idx: number } | null>(null);
  const [editPalletMode, setEditPalletMode] = useState<'edit' | 'assign'>('edit');
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [recoveryContext, setRecoveryContext] = useState<HistoryEntry | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);



  // Pagination State for Inventory

  // Helper to map Supabase data to SheetRow
  const mapInventoryItem = useCallback((item: any): SheetRow => ({
    id: item.id,
    loadingId: item.loading_id,
    originOP: item.origin_op,
    description: item.description,
    lot: item.lot,
    pallets: item.pallets,
    date: item.date,
    status: item.status as StockStatus,
    inspections: item.inspections || [],
    operatorName: item.operatorName
  }), []);

  // Helper to close all modals and sidebar
  const closeAllModals = () => {
    
    setDeleteContext(null);
    setMatrixConfirmContext(null);
    setDetailContext(null);
    setEditPalletContext(null);
    setIsBulkConfirmOpen(false);
    setIsLogoutConfirmOpen(false);
    setIsShipmentModalOpen(false);
    setShipmentDetailContext(null);
    setIsSidebarOpen(false);
  };

  // Handle Browser/Smartphone Back Button
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      // If there's a modal open, the back button should close it first
      const anyModalOpen = 
         
        !!deleteContext || 
        !!matrixConfirmContext || 
        !!detailContext || 
        !!editPalletContext || 
        isBulkConfirmOpen || 
        isLogoutConfirmOpen || 
        isSidebarOpen;

      if (anyModalOpen) {
        closeAllModals();
        return;
      }

      if (event.state && event.state.tab) {
        setActiveTab(event.state.tab);
      } else {
        setActiveTab('dashboard');
      }
    };

    window.addEventListener('popstate', handlePopState);
    
    if (!window.history.state) {
      window.history.replaceState({ tab: activeTab }, '');
    }

    return () => window.removeEventListener('popstate', handlePopState);
  }, [
     
    deleteContext, 
    matrixConfirmContext, 
    detailContext, 
    editPalletContext, 
    isBulkConfirmOpen, 
    isLogoutConfirmOpen, 
    isSidebarOpen,
    activeTab
  ]);


  const addToHistory = useCallback(async (entry: HistoryEntry, silent: boolean = false) => {
    try {
      await supabaseService.addHistoryEntry(entry);
      setHistory(prev => [entry, ...prev]);
      
      // Broadcast to all users
      if (user && !silent) {
        // Broadcast logic removed as notifications are disabled
      }
    } catch (error) {
      if (isFetchOrNetworkError(error)) {
        console.warn('Network issue adding history entry, saved locally:', error);
      } else {
        console.warn('Error adding history entry:', error);
      }
    }
  }, [user]);

  const createHistoryEntry = useCallback((type: HistoryType, row: SheetRow, details: string, palletNum: number = 1): HistoryEntry => {
    const inspection = row.inspections?.[palletNum - 1] || row.inspections?.[0];
    let palletType = '-';
    if (row.is_group) {
      palletType = 'CONSOLIDADO';
    } else if (inspection?.contentType) {
      palletType = translateSlotContent(inspection.contentType);
    } else if (row.description && (row.description.toUpperCase().includes('FRASCO') || row.description.toUpperCase().includes('BOTTLE'))) {
      palletType = 'Frasco';
    } else if (row.description && (
      row.description.toUpperCase().includes('INSUMO') ||
      row.description.toUpperCase().includes('TAMPA') ||
      row.description.toUpperCase().includes('VALVULA') ||
      row.description.toUpperCase().includes('VÁLVULA') ||
      row.description.toUpperCase().includes('ROTULO') ||
      row.description.toUpperCase().includes('RÓTULO') ||
      row.description.toUpperCase().includes('CAIXA')
    )) {
      palletType = 'Insumo';
    } else if (row.status === StockStatus.PENDING) {
      palletType = 'Insumo';
    } else if (row.originOP || row.description) {
      palletType = 'Produto Acabado';
    }

    return {
      id: Math.random().toString(36).substring(2, 9),
      type,
      timestamp: new Date().toLocaleString('pt-BR'),
      loadingId: row.loadingId,
      description: row.description,
      op: row.originOP,
      lot: row.lot,
      palletNumber: palletNum,
      totalPallets: row.pallets,
      slot: inspection?.assignedSlot || row.inspections?.[0]?.assignedSlot || 'N/A',
      details,
      operatorName: user?.name,
      palletType
    };
  }, [user]);

  const createRecoverableExitEntry = useCallback((row: SheetRow, inspection: InspectionData, details: string, palletNum: number = 1, fullRow: boolean = false): HistoryEntry => ({
    ...createHistoryEntry(HistoryType.EXIT, row, details, palletNum),
    slot: inspection.assignedSlot || 'N/A',
    details: `${details}\n${RECOVERY_DATA_MARKER}${JSON.stringify({
      row: {
        ...row,
        inspections: fullRow ? row.inspections : undefined,
        pallets: row.pallets,
        status: fullRow ? row.status : StockStatus.INSPECTED
      },
      inspection,
      fullRow
    })}`
  }), [createHistoryEntry]);

  const navigateToTab = useCallback((tab: typeof activeTab) => {
    if (isPublicView) return;
    if (tab !== activeTab) {
      const start = performance.now();
      window.history.pushState({ tab }, '');
      setActiveTab(tab);
      const end = performance.now();
      console.log(`[Performance] navigateToTab to ${tab} took ${(end - start).toFixed(2)}ms`);
    }
  }, [activeTab, isPublicView, setActiveTab]);





  useEffect(() => {
    const anyModalOpen = 
       
      !!deleteContext || 
      !!matrixConfirmContext || 
      !!detailContext || 
      !!editPalletContext || 
      isBulkConfirmOpen || 
      isLogoutConfirmOpen || 
      isSidebarOpen;

    if (anyModalOpen) {
      if (!window.history.state?.isModal) {
        window.history.pushState({ isModal: true, tab: activeTab }, '');
      }
    } else {
      if (window.history.state?.isModal) {
        window.history.back();
      }
    }
  }, [
     
    !!deleteContext, 
    !!matrixConfirmContext, 
    !!detailContext, 
    !!editPalletContext, 
    isBulkConfirmOpen, 
    isLogoutConfirmOpen, 
    isSidebarOpen,
    activeTab
  ]);

  // Load data from Supabase

  useEffect(() => {
    if (!user && !isPublicView) return;

    const loadData = async () => {
      try {
        const [invPaginatied, slotData, historyRes, shipData, globalStats, pendingRes, waitingRes, countsData, approvalsCount, diagnostic] = await Promise.all([
          supabaseService.getInventoryPaginated(0, PAGE_SIZE, { 
            searchTerm: inventorySearch, 
            typeFilter: inventoryTypeFilter 
          }),
          supabaseService.getSlots(),
          supabaseService.getHistoryPaginated(0, HISTORY_PAGE_SIZE, historySearch),
          supabaseService.getShipments(),
          supabaseService.getGlobalStats(),
          supabaseService.getPendingInventory(),
          supabaseService.getWaitingInventory(),
          supabaseService.getShipmentPalletCounts(),
          supabaseService.getPendingEditRequestsCount(),
          supabaseService.getWarehouseDiagnostic()
        ]);
        setData(invPaginatied.data);
        setHasMoreInventory(invPaginatied.data.length < invPaginatied.count);
        setInventoryPage(0);
        setStats(globalStats);
        setPendingRows(pendingRes);
        setWaitingRows(waitingRes);
        setShipmentCounts(countsData);
        setPendingApprovalsCount(approvalsCount);
        setWarehouseDiagnostic(diagnostic);        
        setHistory(historyRes.data);
        setHasMoreHistory(historyRes.data.length < historyRes.count);
        setHistoryPage(0);
        setShipments(shipData);
        
        // If no slots in DB, initialize them. If fewer slots than expected, add missing ones.
        const expectedSlots = generateSlots();
        if (slotData.length === 0) {
          await supabaseService.bulkUpdateSlots(expectedSlots);
          setSlots(expectedSlots);
        } else if (slotData.length < expectedSlots.length) {
          // Sync missing slots to Supabase
          const existingIds = new Set(slotData.map(s => s.id));
          const missingSlots = expectedSlots.filter(s => !existingIds.has(s.id));
          await supabaseService.bulkUpdateSlots(missingSlots);
          setSlots([...slotData, ...missingSlots]);
        } else {
          setSlots(slotData);
        }
      } catch (error: any) {
        if (isFetchOrNetworkError(error)) {
          console.warn('Network error detected. Disabling Supabase and falling back to offline mode.');
          disableSupabase();
          setTimeout(() => loadData(), 100);
        } else {
          console.error('Error loading data from Supabase:', error);
          showNotification('Erro ao carregar dados do servidor Supabase.', 'error');
        }
      }
    };
    loadData();

    // Set up real-time subscriptions
    const inventoryChannel = supabaseService.subscribeToInventory((payload) => {
      if (payload.eventType === 'INSERT') {
        const newItem = mapInventoryItem(payload.new);
        setData(prev => {
          if (prev.find(r => r.id === newItem.id)) return prev;
          return [newItem, ...prev];
        });
        if (newItem.status === 'PENDING') {
          setPendingRows(prev => [newItem, ...prev.filter(p => p.id !== newItem.id)]);
          if (shouldNotify('analysis-' + newItem.id)) {
            showNotification('Novo pallet aguardando análise', 'info');
            notifyPendingAnalysis(payload.new, () => navigateToTab('analysis'));
          }
        }
      } else if (payload.eventType === 'UPDATE') {
        const updatedItem = mapInventoryItem(payload.new);
        setData(prev => prev.map(r => r.id === updatedItem.id ? updatedItem : r));
        if (updatedItem.status === 'PENDING') {
          setPendingRows(prev => {
            if (prev.find(r => r.id === updatedItem.id)) return prev.map(r => r.id === updatedItem.id ? updatedItem : r);
            return [updatedItem, ...prev];
          });
        } else {
          setPendingRows(prev => prev.filter(r => r.id !== updatedItem.id));
        }
      } else if (payload.eventType === 'DELETE') {
        setData(prev => prev.filter(r => r.id !== payload.old.id));
        setPendingRows(prev => prev.filter(r => r.id !== payload.old.id));
      }
    });

    const editRequestsChannel = supabaseService.subscribeToEditRequests((payload) => {
      if (payload.eventType === 'INSERT' && payload.new.status === 'pending') {
        setPendingApprovalsCount(prev => prev + 1);
        if (user?.role === 'admin' && shouldNotify('approval-' + payload.new.id)) {
          showNotification('Nova solicitação de aprovação', 'info');
          notifyPendingApproval(payload.new, () => navigateToTab('approvals'));
        }
      } else if (payload.eventType === 'UPDATE') {
        if (payload.old.status === 'pending' && payload.new.status !== 'pending') {
          setPendingApprovalsCount(prev => Math.max(0, prev - 1));
        } else if (payload.old.status !== 'pending' && payload.new.status === 'pending') {
          setPendingApprovalsCount(prev => prev + 1);
        }
      } else if (payload.eventType === 'DELETE' && payload.old.status === 'pending') {
        setPendingApprovalsCount(prev => Math.max(0, prev - 1));
      }
    });

    const slotsChannel = supabaseService.subscribeToSlots((payload) => {
      if (payload.eventType === 'UPDATE') {
        const updatedSlot: WarehouseSlot = {
          id: payload.new.id,
          rack: payload.new.rack as any,
          level: payload.new.level,
          position: payload.new.position,
          status: payload.new.status as SlotContent,
          occupiedBy: payload.new.occupied_by
        };
        setSlots(prev => prev.map(s => s.id === updatedSlot.id ? updatedSlot : s));
      }
    });

    const shipmentsChannel = supabaseService.subscribeToShipments((payload) => {
      if (shipmentsRefetchTimerRef.current) clearTimeout(shipmentsRefetchTimerRef.current);
      shipmentsRefetchTimerRef.current = setTimeout(() => {
        supabaseService.getShipments().then(setShipments).catch(err => {
          console.warn('Silent shipments fetch error:', err);
        });
      }, 400);
      if (payload && payload.eventType === 'INSERT' && payload.new.status === 'OPEN') {
        if (shouldNotify('shipment-' + payload.new.id)) {
          showNotification('Novo carregamento criado', 'info');
          notifyShipmentCreated(payload.new, () => navigateToTab('shipments'));
        }
      }
    });

    const historyChannel = supabaseService.subscribeToHistory((payload) => {
      if (payload && payload.eventType === 'INSERT') {
        const newHist = mapHistoryRow(payload.new);
        setHistory(prev => {
          if (prev.some(h => h.id === newHist.id)) return prev;
          return [newHist, ...prev];
        });
        if (shouldNotify('history-' + newHist.id)) {
          notifyMovementDone(newHist, () => navigateToTab('history'));
        }
      }
    });

    // Realtime Broadcast Channel (Instant sync across active sessions without database lag)
    const broadcastSubscription = supabaseService.subscribeToAppBroadcast((event, payload) => {
      if (event === 'inventory:saved') {
        const item = payload.item;
        if (!item) return;
        setData(prev => {
          const exists = prev.some(r => r.id === item.id);
          if (exists) return prev.map(r => r.id === item.id ? item : r);
          return [item, ...prev];
        });
        if (item.status === 'PENDING') {
          setPendingRows(prev => {
            const exists = prev.some(r => r.id === item.id);
            if (exists) return prev.map(r => r.id === item.id ? item : r);
            return [item, ...prev];
          });
          if (shouldNotify('analysis-' + item.id)) {
            showNotification('Novo pallet aguardando análise', 'info');
            notifyPendingAnalysis(item, () => navigateToTab('analysis'));
          }
        } else {
          setPendingRows(prev => prev.filter(r => r.id !== item.id));
        }
      } else if (event === 'inventory:deleted') {
        setData(prev => prev.filter(r => r.id !== payload.id));
        setPendingRows(prev => prev.filter(r => r.id !== payload.id));
      } else if (event === 'slot:updated') {
        const slot = payload.slot;
        if (slot) {
          setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, ...slot } : s));
        }
      } else if (event === 'slots:bulk_updated') {
        const incomingSlots: WarehouseSlot[] = payload.slots || [];
        const slotMap = new Map(incomingSlots.map(s => [s.id, s]));
        setSlots(prev => prev.map(s => slotMap.has(s.id) ? { ...s, ...slotMap.get(s.id)! } : s));
      } else if (event === 'shipment:saved') {
        if (shipmentsRefetchTimerRef.current) clearTimeout(shipmentsRefetchTimerRef.current);
        shipmentsRefetchTimerRef.current = setTimeout(() => {
          supabaseService.getShipments().then(setShipments).catch(() => {});
        }, 400);
        if (payload.shipment?.status === 'OPEN' && shouldNotify('shipment-' + payload.shipment.id)) {
          showNotification('Novo carregamento criado', 'info');
          notifyShipmentCreated(payload.shipment, () => navigateToTab('shipments'));
        }
      } else if (event === 'shipment:deleted') {
        setShipments(prev => prev.filter(s => s.id !== payload.shipmentId));
      } else if (event === 'approval:requested') {
        setPendingApprovalsCount(prev => prev + 1);
        if (user?.role === 'admin' && shouldNotify('approval-' + (payload.request?.id || Date.now()))) {
          showNotification('Nova solicitação de aprovação', 'info');
          notifyPendingApproval(payload.request, () => navigateToTab('approvals'));
        }
      } else if (event === 'approval:resolved') {
        setPendingApprovalsCount(prev => Math.max(0, prev - 1));
        refreshCombinedData();
      } else if (event === 'history:saved') {
        const entry = payload.entry;
        if (entry) {
          setHistory(prev => [entry, ...prev.filter(h => h.id !== entry.id)]);
          if (shouldNotify('history-' + entry.id)) {
            notifyMovementDone(entry, () => navigateToTab('history'));
          }
        }
      }
    });

    // Realtime Operator Presence
    let presenceSubscription: any = null;
    if (user && !isPublicView) {
      presenceSubscription = supabaseService.trackPresence(
        { id: user.id, name: user.name, role: user.role, email: user.email },
        (activeUsers) => {
          const list = [...activeUsers];
          if (user && !list.some(u => (user.id && u.id === user.id) || u.name === user.name)) {
            list.push({ id: user.id, name: user.name, role: user.role, email: user.email, sessionId: clientSessionId });
          }
          const seen = new Set();
          const unique = list.filter(u => {
            const k = u.id || u.name;
            if (!k || seen.has(k)) return false;
            seen.add(k);
            return true;
          });
          setOnlineOperators(unique);
        }
      );
    }

    return () => {
      if (shipmentsRefetchTimerRef.current) clearTimeout(shipmentsRefetchTimerRef.current);
      inventoryChannel?.unsubscribe?.();
      editRequestsChannel?.unsubscribe?.();
      slotsChannel?.unsubscribe?.();
      shipmentsChannel?.unsubscribe?.();
      historyChannel?.unsubscribe?.();
      broadcastSubscription?.unsubscribe?.();
      presenceSubscription?.unsubscribe?.();
    };
  }, [user, isPublicView]);

  const handleExportInventory = async () => {
    try {
      showNotification('Preparando exportação completa...', 'info');
      // Fetch ALL inventory matching current filters for export
      const allFilteredData = await supabaseService.getAllInventoryForExport({
        searchTerm: inventorySearch,
        typeFilter: inventoryTypeFilter
      });

      // Prepare data for export
      const exportData = allFilteredData.flatMap(row => {
        // Only export items that are in stock (not pending analysis)
        if (row.status === StockStatus.PENDING) return [];

        return (row.inspections || []).map(insp => ({
          op: row.originOP,
          nome: row.description,
          lote: row.lot,
          quantidade: insp.bottles || 0,
          tipo: translateSlotContent(insp.contentType)
        }));
      });

      if (exportData.length === 0) {
        showNotification('Não há dados para exportar.', 'error');
        return;
      }

      const csv = Papa.unparse(exportData);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      
      link.setAttribute('href', url);
      link.setAttribute('download', `estoque_geral_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      showNotification('Estoque exportado com sucesso!');
    } catch (error) {
      console.error('Export error:', error);
      showNotification('Erro ao exportar estoque.', 'error');
    }
  };

  const BACKUP_STORAGE_KEY = 'stoque_last_backup_date';

  const handleDownloadFullBackup = async () => {
    if (user?.role !== 'admin') {
      showNotification('Apenas administradores podem baixar backup.', 'error');
      return;
    }
    try {
      setIsBackupDownloading(true);
      showNotification('Gerando backup completo...', 'info');

      const [fullInventory, fullHistory, fullShipments, fullSlots, rotativeStock, profiles, editRequests] = await Promise.all([
        supabaseService.getAllInventoryForExport({ includeGrouped: true }),
        supabaseService.getHistory(),
        supabaseService.getShipments(),
        supabaseService.getSlots(),
        supabaseService.getRotativeStock().catch(() => []),
        supabaseService.getProfiles().catch(() => []),
        supabaseService.getEditRequests().catch(() => []),
      ]);

      const backupPayload = {
        geradoEm: new Date().toISOString(),
        origem: 'Stoque+',
        versao: 1,
        dados: {
          inventario: fullInventory,
          historico: fullHistory,
          carregamentos: fullShipments,
          vagas: fullSlots,
          estoqueRotativo: rotativeStock,
          usuarios: profiles,
          solicitacoesEdicao: editRequests,
        },
      };

      const json = JSON.stringify(backupPayload, null, 2);
      const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);

      link.setAttribute('href', url);
      link.setAttribute('download', `stoque_backup_${new Date().toISOString().split('T')[0]}.json`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      try {
        localStorage.setItem(BACKUP_STORAGE_KEY, new Date().toISOString().split('T')[0]);
      } catch {
        // localStorage indisponível — o lembrete pode reaparecer nesta sessão, sem problema
      }

      setIsBackupModalOpen(false);
      showNotification('Backup baixado com sucesso!');
    } catch (error) {
      console.error('Backup error:', error);
      showNotification('Erro ao gerar o backup.', 'error');
    } finally {
      setIsBackupDownloading(false);
    }
  };

  // Verifica uma vez por sessão (a partir das 08:00) se o backup de hoje já foi feito.
  // Se não foi, mostra o modal de lembrete apenas para administradores.
  useEffect(() => {
    if (!user || user.role !== 'admin' || isPublicView) return;
    if (backupModalCheckedRef.current) return;

    const checkBackupReminder = () => {
      const now = new Date();
      if (now.getHours() < 8) return;

      const todayStr = now.toISOString().split('T')[0];
      let lastBackupDate: string | null = null;
      try {
        lastBackupDate = localStorage.getItem(BACKUP_STORAGE_KEY);
      } catch {
        lastBackupDate = null;
      }

      if (lastBackupDate !== todayStr) {
        backupModalCheckedRef.current = true;
        setIsBackupModalOpen(true);
      }
    };

    checkBackupReminder();
  }, [user, isPublicView]);

  const RESTORE_LABELS: Record<string, string> = {
    vagas: 'vagas',
    inventario: 'itens de estoque',
    historico: 'registros de histórico',
    carregamentos: 'carregamentos',
    estoqueRotativo: 'itens de estoque rotativo',
  };

  const handleRestoreBackup = async (backupJson: any) => {
    // A restauração apaga e reinsere centenas/milhares de linhas de uma vez; sem essa trava, cada
    // linha inserida dispararia sua própria notificação via os canais realtime (toast + som). Uma
    // única notificação-resumo no final é o que faz sentido para uma operação em lote como essa.
    suppressRealtimeNotificationsRef.current = true;
    let result;
    try {
      result = await supabaseService.restoreFullBackup(backupJson);
    } finally {
      suppressRealtimeNotificationsRef.current = false;
    }

    const parts = Object.entries(result.summary)
      .filter(([, count]) => Number(count) > 0)
      .map(([key, count]) => `${count} ${RESTORE_LABELS[key] || key}`);

    if (Object.keys(result.failed || {}).length > 0) {
      showNotification(`Backup restaurado parcialmente: ${parts.join(', ') || 'nenhum registro'}. Confira os detalhes no modal.`, 'error');
    } else {
      showNotification(`Backup restaurado: ${parts.join(', ') || 'nenhum registro novo'}.`);
    }

    return result;
  };

  const handleShareDashboard = () => {
    const publicUrl = `${window.location.origin}${window.location.pathname}?view=public`;
    navigator.clipboard.writeText(publicUrl).then(() => {
      showNotification('Link do Dashboard Público copiado!', 'info');
    }).catch(err => {
      console.error('Erro ao copiar link:', err);
      showNotification('Erro ao copiar link.', 'error');
    });
  };

  const getContainerColor = (contentType?: SlotContent) => {
    switch (contentType) {
      case SlotContent.CONTAINER_LP: return 'text-slate-100';
      case SlotContent.CONTAINER_SJ: return 'text-orange-900';
      case SlotContent.CONTAINER_CP: return 'text-fuchsia-500';
      default: return 'text-slate-100';
    }
  };

  const performStackReorganization = async (currentData: SheetRow[], currentSlots: WarehouseSlot[]) => {
    // Re-enabled but will be carefully applied
    const racksToProcess: ('E' | 'F')[] = ['E', 'F'];
    let newData = [...currentData];
    let newSlots = [...currentSlots];
    
    let hasChanges = false;
    const itemsToUpdateMap = new Map<string, SheetRow>();
    const slotsToUpdateMap = new Map<string, WarehouseSlot>();

    racksToProcess.forEach(rack => {
      // Find all positions (columns) for this rack
      const rackSlots = currentSlots.filter(s => s.rack === rack);
      const positions = Array.from(new Set(rackSlots.map(s => s.position))).sort((a,b) => a-b);
      
      positions.forEach(pos => {
        const stackPallets: { rowId: string, idx: number, level: number, insp: InspectionData }[] = [];
        
        newData.forEach(row => {
          row.inspections?.forEach((insp, idx) => {
            if (insp.assignedSlot?.startsWith(`${rack}.`)) {
              const parts = insp.assignedSlot.split('.');
              // Parts: Rack (0), Level (1), Position (2)
              if (parseInt(parts[2]) === pos && parts[0] === rack) {
                stackPallets.push({ rowId: row.id, idx, level: parseInt(parts[1]), insp: { ...insp } });
              }
            }
          });
        });

        if (stackPallets.length === 0) return;

        // Skip reorganization for container stacks as per user request
        const hasContainer = stackPallets.some(p => 
          p.insp.contentType === SlotContent.CONTAINER_SJ || 
          p.insp.contentType === SlotContent.CONTAINER_LP || 
          p.insp.contentType === SlotContent.CONTAINER_CP
        );
        if (hasContainer) return;

        // Sort by CURRENT level (bottom to top)
        stackPallets.sort((a, b) => a.level - b.level);

        // Check if there is a gap or shift needed
        let stackNeedsShift = false;
        stackPallets.forEach((p, i) => {
          if (p.level !== i + 1) stackNeedsShift = true;
        });

        if (stackNeedsShift) {
          hasChanges = true;
          
          // Re-assign in data
          stackPallets.forEach((p, i) => {
            const targetLevel = i + 1;
            const targetSlotId = `${rack}.${targetLevel}.${pos}`;
            
            const rIdx = newData.findIndex(r => r.id === p.rowId);
            const insps = [...newData[rIdx].inspections!];
            insps[p.idx] = { ...insps[p.idx], assignedSlot: targetSlotId };
            newData[rIdx] = { ...newData[rIdx], inspections: insps };
            itemsToUpdateMap.set(p.rowId, newData[rIdx]);
          });

          // Re-assign in slots
          // 1. Clear ONLY THIS stack
          const stackSlots = newSlots.filter(s => s.rack === rack && s.position === pos);
          stackSlots.forEach(s => {
            const sIdx = newSlots.findIndex(sc => sc.id === s.id);
            newSlots[sIdx] = { ...newSlots[sIdx], status: SlotContent.EMPTY, occupiedBy: undefined };
            slotsToUpdateMap.set(s.id, newSlots[sIdx]);
          });

          // 2. Fill stack from bottom up
          stackPallets.forEach((p, i) => {
            const targetLevel = i + 1;
            const targetSlotId = `${rack}.${targetLevel}.${pos}`;
            const sIdx = newSlots.findIndex(s => s.id === targetSlotId);
            
            if (sIdx !== -1) {
              const row = newData.find(r => r.id === p.rowId);
              newSlots[sIdx] = { 
                ...newSlots[sIdx], 
                status: p.insp.contentType, 
                occupiedBy: row?.originOP || row?.description 
              };
              slotsToUpdateMap.set(targetSlotId, newSlots[sIdx]);
            }
          });
        }
      });
    });

    if (hasChanges) {
      const invUpdates = Array.from(itemsToUpdateMap.values());
      const slotUpdates = Array.from(slotsToUpdateMap.values());
      
      try {
        await Promise.all([
          ...invUpdates.map(item => supabaseService.saveInventoryItem(item)),
          supabaseService.bulkUpdateSlots(slotUpdates)
        ]);
        
        setData(newData);
        setSlots(newSlots);
        console.log(`Ponte: Reorganização de pilhas E/F concluída. ${invUpdates.length} itens movidos.`);
      } catch (error) {
        console.error('Stack reorganization failed:', error);
        showNotification('Erro ao reorganizar pilhas E/F. Verifique o estoque manualmente.', 'error');
      }
    }
  };

  const [selectedMappingSlot, setSelectedMappingSlot] = useState<WarehouseSlot | null>(null);

  const handleDedicateSlot = async (slot: WarehouseSlot) => {
    try {
      await supabaseService.updateSlot({
        ...slot,
        status: SlotContent.ROTATIVE,
        occupiedBy: 'ESTOQUE ROTATIVO'
      });
      setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, status: SlotContent.ROTATIVE, occupiedBy: 'ESTOQUE ROTATIVO' } : s));
      showNotification(`Vaga ${slot.id} dedicada ao Estoque Rotativo`);
      setSelectedMappingSlot(null);
      
    } catch (error) {
      console.error('Error dedicating slot:', error);
      showNotification('Erro ao dedicar vaga', 'error');
    }
  };

  const handleReleaseSlot = async (slot: WarehouseSlot) => {
    // Check if there are items in this slot first
    try {
      const rotativeItems = await supabaseService.getRotativeStock();
      const itemsInSlot = rotativeItems.filter(i => i.slotId === slot.id);
      
      if (itemsInSlot.length > 0) {
        showNotification('Não é possível liberar uma vaga que contém itens no estoque rotativo', 'error');
        return;
      }

      await supabaseService.updateSlot({
        ...slot,
        status: SlotContent.EMPTY,
        occupiedBy: undefined
      });
      setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, status: SlotContent.EMPTY, occupiedBy: undefined } : s));
      showNotification(`Vaga ${slot.id} liberada do Estoque Rotativo`);
      setSelectedMappingSlot(null);
      
    } catch (error) {
      console.error('Error releasing slot:', error);
      showNotification('Erro ao liberar vaga', 'error');
    }
  };

  const handleLogout = async () => {
    try {
      await supabaseService.signOut();
      setUser(null);
      setIsLogoutConfirmOpen(false);
      showNotification('Sessão encerrada com sucesso.');
    } catch (error) {
      console.error('Logout error:', error);
      showNotification('Erro ao encerrar sessão. Tente novamente.', 'error');
    }
  };

  const handleImportProcess = async (entries: { row: SheetRow, slotId: string }[]) => {
    try {
      // 1. Pre-validation: check if any of the target slots are occupied
      const physicalSlotsToCheck = entries.filter(e => e.slotId && e.slotId !== 'AGUARDANDO').map(e => e.slotId);
      if (physicalSlotsToCheck.length > 0) {
        // We could fetch all slots, but for simplicity we fetch the current state to be sure
        const allSlots = await supabaseService.getSlots();
        const occupied = physicalSlotsToCheck.filter(id => {
          const s = allSlots.find(slot => slot.id === id);
          return s && s.status !== SlotContent.EMPTY;
        });

        if (occupied.length > 0) {
          showNotification(`A importação foi cancelada pois as seguintes vagas já estão ocupadas: ${occupied.join(', ')}. Atualize os dados e tente novamente com outras vagas.`, 'error');
          refreshCombinedData();
          return;
        }
      }

      const updatedSlots = [...slots];
      const newRows: SheetRow[] = [];
      const newHistory: HistoryEntry[] = [];

      for (const entry of entries) {
        const { row, slotId } = entry;
        
        // Update Slot in local array if provided
        if (slotId) {
          const slotIdx = updatedSlots.findIndex(s => s.id === slotId);
          if (slotIdx !== -1) {
            updatedSlots[slotIdx] = {
              ...updatedSlots[slotIdx],
              status: row.inspections?.[0]?.contentType || SlotContent.SUPPLIES,
              occupiedBy: row.originOP || row.description
            };
          }
        }

        newRows.push({
          ...row,
          operatorName: user?.name
        });
        // Only add to history if it's a final entry (has slot)
        if (slotId) {
          const importContentType = row.inspections?.[0]?.contentType || SlotContent.SUPPLIES;
          const importPalletType = row.is_group ? 'CONSOLIDADO' : translateSlotContent(importContentType);

          newHistory.push({
            id: Math.random().toString(36).substring(2, 9),
            type: HistoryType.ENTRY,
            timestamp: new Date().toLocaleString(),
            loadingId: row.loadingId,
            description: row.description,
            op: row.originOP,
            lot: row.lot,
            palletNumber: 1,
            totalPallets: 1,
            slot: slotId,
            details: `Importação via CSV por ${user?.name || 'Sistema'}. ID: ${row.loadingId}`,
            operatorName: user?.name,
            palletType: importPalletType
          });
        }
      }

      // Bulk updates in Supabase — suprime notificações por item nos canais realtime (senão cada
      // pallet importado dispararia sua própria notificação); uma única no final já basta.
      suppressRealtimeNotificationsRef.current = true;
      try {
        await Promise.all([
          supabaseService.bulkUpdateSlots(updatedSlots),
          ...newRows.map(r => supabaseService.saveInventoryItem(r)),
          ...newHistory.map(h => supabaseService.addHistoryEntry(h))
        ]);
      } finally {
        suppressRealtimeNotificationsRef.current = false;
      }

      // Update local state
      setSlots(updatedSlots);
      setData(prev => [...newRows, ...prev]);
      setHistory(prev => [...newHistory, ...prev]);

      showNotification(`${entries.length} pallets importados com sucesso!`);
      
      // If they were imported as PENDING, go to analysis
      if (entries[0]?.row.status === StockStatus.PENDING) {
        navigateToTab('analysis');
      } else {
        navigateToTab('inventory');
      }
      refreshCombinedData();
    } catch (error: any) {
      console.error('Import processing error:', error);
      showNotification(`Erro ao processar importação: ${error.message}`, 'error');
    }
  };

  const handleConfirmAnalysis = useCallback(async (
    rowId: string, 
    slotId: string, 
    finalId: string, 
    updatedFields?: Partial<SheetRow>, 
    updatedInspection?: Partial<InspectionData>
  ) => {
    try {
      const row = data.find(r => r.id === rowId) || pendingRows.find(r => r.id === rowId);
      if (!row) return;

      // 1. Pre-validation: check if slot is still free or shareable
      const isWaiting = slotId === 'AGUARDANDO';
      if (!isWaiting) {
        const currentSlot = await supabaseService.getSlotById(slotId);
        if (currentSlot && currentSlot.status !== SlotContent.EMPTY) {
          const isOccupantShareable = SHAREABLE_SLOT_TYPES.includes(currentSlot.status);
          const isNewItemShareable = updatedInspection?.contentType 
            ? SHAREABLE_SLOT_TYPES.includes(updatedInspection.contentType as SlotContent) 
            : (row.inspections?.[0]?.contentType ? SHAREABLE_SLOT_TYPES.includes(row.inspections[0].contentType) : false);

          if (!isOccupantShareable || !isNewItemShareable) {
            showNotification(`A vaga ${slotId} já está ocupada por um item que não permite compartilhamento.`, 'error');
            refreshCombinedData();
            return;
          }
        }
      }

      const updatedRow: SheetRow = {
        ...row,
        ...updatedFields,
        loadingId: finalId,
        status: StockStatus.INSPECTED,
        operatorName: user?.name,
        inspections: row.inspections?.map(insp => ({ 
          ...insp, 
          ...updatedInspection, 
          assignedSlot: slotId 
        }))
      };

      let updatedSlot: WarehouseSlot | null = null;

      if (!isWaiting) {
        const targetSlot = slots.find(s => s.id === slotId);
        if (!targetSlot) throw new Error('Vaga não encontrada');

        updatedSlot = {
          ...targetSlot,
          status: updatedInspection?.contentType || row.inspections?.[0]?.contentType || SlotContent.SUPPLIES,
          occupiedBy: updatedFields?.originOP || updatedFields?.description || row.originOP || row.description
        };
      }

      const confirmedContentType = updatedInspection?.contentType || row.inspections?.[0]?.contentType || SlotContent.SUPPLIES;
      const confirmedPalletType = row.is_group ? 'CONSOLIDADO' : translateSlotContent(confirmedContentType);

      const historyEntry: HistoryEntry = {
        id: Math.random().toString(36).substring(2, 9),
        type: HistoryType.ENTRY,
        timestamp: new Date().toLocaleString(),
        loadingId: finalId,
        description: updatedFields?.description || row.description,
        op: updatedFields?.originOP || row.originOP,
        lot: updatedFields?.lot || row.lot,
        palletNumber: 1,
        totalPallets: 1,
        slot: isWaiting ? 'AGUARDANDO' : slotId,
        details: `Entrada confirmada por ${user?.name || 'Operador'}. ID Final: ${finalId}${isWaiting ? ' (Aguardando Vaga)' : ''}`,
        operatorName: user?.name,
        palletType: confirmedPalletType
      };

      const promises: Promise<any>[] = [
        supabaseService.saveInventoryItem(updatedRow),
        addToHistory(historyEntry)
      ];

      if (updatedSlot) {
        promises.push(supabaseService.updateSlot(updatedSlot));
      }

      await Promise.all(promises);

      setPendingRows(prev => prev.filter(r => r.id !== rowId));
      setData(prev => prev.map(r => r.id === rowId ? updatedRow : r));
      if (updatedSlot) {
        const newSlot = updatedSlot;
        setSlots(prev => prev.map(s => s.id === slotId ? newSlot : s));
      }

      showNotification(`Entrada confirmada! ID: ${finalId}`);
      refreshCombinedData();
      
      // Auto-reorganize E/F stacks
      performStackReorganization(
        data.map(r => r.id === rowId ? updatedRow : r),
        updatedSlot ? slots.map(s => s.id === slotId ? updatedSlot : s) : slots
      );
    } catch (error: any) {
      console.error('Analysis confirmation error:', error);
      showNotification(`Erro ao confirmar análise: ${error.message}`, 'error');
    }
  }, [data, pendingRows, slots, user, addToHistory]);

  const handleRejectAnalysis = async (rowId: string) => {
    try {
      await supabaseService.deleteInventoryItem(rowId);
      setPendingRows(prev => prev.filter(r => r.id !== rowId));
      setData(prev => prev.filter(r => r.id !== rowId));
      showNotification('Pallet rejeitado e removido da fila.');
      refreshCombinedData();
    } catch (error: any) {
      console.error('Analysis rejection error:', error);
      showNotification(`Erro ao rejeitar pallet: ${error.message}`, 'error');
    }
  };

  const handleRecoverPallet = async (entry: HistoryEntry) => {
    if (!user) return;
    
    // We assume the payload is there if the button shows
    const rawDetails = entry.details || '';
    if (!rawDetails.includes(RECOVERY_DATA_MARKER)) {
      showNotification('Este registro não suporta recuperação automática ou está corrompido.', 'error');
      return;
    }

    setRecoveryContext(entry);
  };

  const confirmRecovery = async (reason: string) => {
    if (!user || !recoveryContext) return;
    
    setIsRecovering(true);
    try {
      const payloadStr = recoveryContext.details!.split(RECOVERY_DATA_MARKER)[1];
      const payload = JSON.parse(payloadStr);

      const recoveryData = {
        ...payload.row,
        pallets: recoveryContext.totalPallets ?? payload.row.pallets,
        inspections: payload.fullRow ? payload.row.inspections : [{ ...payload.inspection }]
      };

      // Create an approval request since "a recuperação vira uma solicitação e só o admin aprova"
      await supabaseService.createEditRequest({
        inventory_id: null as unknown as string, // Might be nullable. If it fails, we will try something else.
        requested_by: user.id,
        before_data: {}, // Supabase does not allow null for this column
        after_data: {
          ...recoveryData,
          _isRecovery: true // Custom flag for processEditRequest
        },
        reason: `Recuperação de Pallet (ID: ${payload.row.loadingId || recoveryData.id}) - Motivo: ${reason}`
      });

      showNotification('Solicitação de recuperação enviada para aprovação do administrador.', 'info');
      setRecoveryContext(null);
    } catch (error) {
      console.error('Error recovering pallet:', error);
      showNotification('Erro ao criar solicitação de recuperação.', 'error');
    } finally {
      setIsRecovering(false);
    }
  };

  const handleResyncSlots = async () => {
    try {
      showNotification('Iniciando sincronização de vagas e limpeza...', 'info');
      
      const [slotResult, ghostResult] = await Promise.all([
        supabaseService.resyncSlots(),
        supabaseService.cleanupGhostPallets()
      ]);
      
      // Update local state with fresh data
      const freshSlots = await supabaseService.getSlots();
      setSlots(freshSlots);
      
      if (slotResult.fixed > 0 || ghostResult.removed > 0) {
        showNotification(
          `${slotResult.fixed > 0 ? `${slotResult.fixed} vaga(s) liberada(s). ` : ''}${ghostResult.removed > 0 ? `${ghostResult.removed} pallet(s) fantasma removido(s).` : ''}`, 
          'success'
        );
      } else {
        showNotification('Todas as vagas e inventário já estão sincronizados.', 'info');
      }
      
      refreshCombinedData();
    } catch (error: any) {
      console.error('Resync error:', error);
      showNotification(`Erro ao sincronizar: ${error.message}`, 'error');
    }
  };

  const handleCreateShipment = async (shipmentData: { type: ShipmentType, scheduledDate: string }) => {
    try {
      const newShipment: Shipment = {
        id: `SHIP-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
        type: shipmentData.type,
        status: ShipmentStatus.OPEN,
        createdAt: new Date().toISOString(),
        scheduledDate: shipmentData.scheduledDate,
        operatorName: user?.name
      };

      const selections = selectedPallets.map(id => {
        const [rowId, palletIdx] = id.split('::');
        return { rowId, palletIdx: parseInt(palletIdx) };
      });

      await supabaseService.saveShipment(newShipment);
      await supabaseService.updateInventoryShipment(selections, newShipment.id);
      
      // Update local state immediately

      showNotification(`Carregamento ${newShipment.id} criado com sucesso!`);
      setSelectedPallets([]);
      refreshCombinedData();
    } catch (error: any) {
      console.error('Error creating shipment:', error);
      showNotification(`Erro ao criar carregamento: ${error.message}`, 'error');
    }
  };

  const handleAddToShipment = async (shipmentId: string) => {
    try {
      const selections = selectedPallets.map(id => {
        const [rowId, palletIdx] = id.split('::');
        return { rowId, palletIdx: parseInt(palletIdx) };
      });

      await supabaseService.updateInventoryShipment(selections, shipmentId);
      
      // Update local inventory state
      const result = await supabaseService.getInventoryPaginated(0, data.length || PAGE_SIZE);
      setData(result.data);
      
      showNotification(`Pallets adicionados ao carregamento ${shipmentId}!`);
      
      setSelectedPallets([]);
      refreshCombinedData();
    } catch (error: any) {
      console.error('Error adding to shipment:', error);
      showNotification(`Erro ao adicionar ao carregamento: ${error.message}`, 'error');
    }
  };

  const handleAddToShipmentSingle = async (pallet: SheetRow, shipmentId: string) => {
    try {
      // For single pallet search, we assume idx 0 as we usually split them or just use the first item's index
      // But in this app, pallets in inventory are often grouped. 
      // If found by slot, it might be a specific entry.
      
      const selection = { rowId: pallet.id, palletIdx: 0 }; // Default to 0 if not specified
      await supabaseService.updateInventoryShipment([selection], shipmentId);
      
      // Refresh
      const result = await supabaseService.getInventoryPaginated(0, data.length || PAGE_SIZE);
      setData(result.data);
      
      fetchShipmentDetailPallets(shipmentId);
      showNotification(`Pallet adicionado ao carregamento ${shipmentId}!`);
      refreshCombinedData();
    } catch (error: any) {
      console.error('Error adding single pallet to shipment:', error);
      showNotification(`Erro ao adicionar pallet: ${error.message}`, 'error');
    }
  };

  // Marca um pallet vinculado a um carregamento aberto como "AG VAGA": o material já foi
  // separado fisicamente, então a vaga é liberada no sistema (podendo ser ocupada por outro
  // pallet), enquanto o pallet segue no carregamento até ele ser finalizado. A vaga original
  // fica guardada em `preShipmentSlot` para ser restaurada automaticamente se o carregamento
  // for excluído antes de finalizar (ver handleDeleteShipment).
  const handleMoveToWaitingSlot = async (palletId: string) => {
    try {
      const [rowId, palletIdxStr] = palletId.split('::');
      const palletIdx = parseInt(palletIdxStr, 10);

      const rows = await supabaseService.getInventoryItemsByIds([rowId]);
      const row = rows[0];
      const insp = row?.inspections?.[palletIdx];

      if (!row || !insp) {
        showNotification('Pallet não encontrado.', 'error');
        return;
      }

      const currentSlot = insp.assignedSlot;
      if (isPendingSlot(currentSlot)) {
        showNotification('Este pallet já está aguardando vaga.', 'info');
        return;
      }

      // 1. Marca a inspeção como aguardando vaga, guardando a vaga original
      const updatedInspections = [...row.inspections!];
      updatedInspections[palletIdx] = {
        ...insp,
        preShipmentSlot: currentSlot,
        assignedSlot: 'AGUARDANDO'
      };
      await supabaseService.saveInventoryItem({ ...row, inspections: updatedInspections });

      // 2. Libera a vaga no sistema, caso nenhum outro pallet/índice ainda aponte para ela
      const others = await supabaseService.findPalletsBySlot(currentSlot!);
      const stillOccupied = others.some(r =>
        (r.inspections || []).some((i: any, i2: number) =>
          i.assignedSlot === currentSlot && (r.id !== row.id || i2 !== palletIdx)
        )
      );
      if (!stillOccupied) {
        await supabaseService.freeSlot(currentSlot!);
        setSlots(prev => prev.map(s => s.id === currentSlot ? { ...s, status: SlotContent.EMPTY, occupiedBy: undefined } : s));
      }

      await addToHistory({
        id: Math.random().toString(36).substring(2, 9),
        type: HistoryType.TRANSFER,
        timestamp: new Date().toLocaleString(),
        loadingId: row.loadingId,
        description: row.description,
        op: row.originOP,
        lot: row.lot,
        palletNumber: palletIdx + 1,
        totalPallets: row.pallets,
        slot: 'AGUARDANDO',
        details: `Material separado para carregamento. Vaga ${currentSlot} liberada no sistema.`,
        operatorName: user?.name,
        palletType: row.is_group ? 'CONSOLIDADO' : (insp.contentType ? translateSlotContent(insp.contentType) : 'Produto Acabado')
      }, true);

      showNotification(`Vaga ${currentSlot} liberada. Pallet marcado como AG VAGA.`);

      const result = await supabaseService.getInventoryPaginated(0, data.length || PAGE_SIZE);
      setData(result.data);
      refreshCombinedData();
    } catch (error: any) {
      console.error('Error moving pallet to waiting slot:', error);
      showNotification(`Erro ao mover pallet para AG Vaga: ${error.message}`, 'error');
    }
  };

  const handleRemoveFromShipment = async (palletId: string) => {
    try {
      const [rowId, palletIdx] = palletId.split('::');
      await supabaseService.updateInventoryShipment([{ rowId, palletIdx: parseInt(palletIdx) }], null);
      showNotification('Pallet removido do carregamento.');
      
      refreshCombinedData();
    } catch (error: any) {
      console.error('Error removing from shipment:', error);
      showNotification(`Erro ao remover pallet: ${error.message}`, 'error');
    }
  };

  const handleFinalizeShipment = async (shipmentId: string) => {
    try {
      const shipment = shipments.find(s => s.id === shipmentId);
      if (!shipment) return;

      // 1. Find all pallets linked to this shipment directly from server
      const linkedPallets = await supabaseService.getInventoryItemsByShipmentId(shipmentId);
      
      const itemsToProcess: { row: SheetRow, palletIndices: number[] }[] = [];
      linkedPallets.forEach(row => {
        const indices = (row.inspections || [])
          .map((insp, idx) => {
            const sId = insp.shipmentId || (insp as any).shipment_id;
            return sId === shipmentId ? idx : -1;
          })
          .filter(idx => idx !== -1);
        
        if (indices.length > 0) {
          itemsToProcess.push({ row, palletIndices: indices });
        }
      });

      if (itemsToProcess.length === 0) {
        showNotification('Nenhum pallet encontrado para este carregamento.', 'error');
        return;
      }

      // 2. Update shipment status
      const updatedShipment = { 
        ...shipment, 
        status: ShipmentStatus.CLOSED,
        closedAt: new Date().toISOString()
      };
      await supabaseService.saveShipment(updatedShipment);

      // 3. Process exit for each pallet
      // Evita que cada pallet baixado dispare sua própria notificação (toast + som) via o canal
      // realtime do histórico — aqui é uma única operação (finalizar o carregamento), então só
      // uma notificação-resumo é mostrada no final, com o total de pallets.
      let totalPalletsExited = 0;
      suppressRealtimeNotificationsRef.current = true;
      try {
        for (const { row, palletIndices } of itemsToProcess) {
          // Sort indices descending to remove from array without affecting previous indices
          const sortedIndices = [...palletIndices].sort((a, b) => b - a);

          for (const idx of sortedIndices) {
            const inspection = row.inspections![idx];

            // Update Slot
            if (inspection.assignedSlot && inspection.assignedSlot !== 'AGUARDANDO') {
              await supabaseService.freeSlot(inspection.assignedSlot);
              // Updating local state too specifically for E/F reorganization logic that might run next
              setSlots(prev => prev.map(s => s.id === inspection.assignedSlot ? { ...s, status: SlotContent.EMPTY, occupiedBy: undefined } : s));
            }

            // Add History
            const exitPalletType = row.is_group
              ? 'CONSOLIDADO'
              : (inspection.contentType ? translateSlotContent(inspection.contentType) : 'Produto Acabado');

            await addToHistory({
              id: Math.random().toString(36).substring(2, 9),
              type: HistoryType.EXIT,
              timestamp: new Date().toLocaleString(),
              loadingId: row.loadingId,
              description: row.description,
              op: row.originOP,
              lot: row.lot,
              palletNumber: idx + 1,
              totalPallets: row.pallets,
              slot: inspection.assignedSlot || 'N/A',
              details: `Saída automática via Finalização de Carregamento ${shipmentId}`,
              operatorName: user?.name,
              palletType: exitPalletType
            }, true);
            totalPalletsExited++;
          }

          // Update or Delete Inventory Item
          const remainingInspections = row.inspections!.filter((_, i) => !palletIndices.includes(i));
          if (remainingInspections.length === 0) {
            await supabaseService.deleteInventoryItem(row.id);
          } else {
            const updatedRow = {
              ...row,
              inspections: remainingInspections,
              };
            await supabaseService.saveInventoryItem(updatedRow);
          }
        }
      } finally {
        suppressRealtimeNotificationsRef.current = false;
      }

      const palletLabel = totalPalletsExited === 1 ? '1 pallet' : `${totalPalletsExited} pallets`;
      showNotification(`Carregamento ${shipmentId} finalizado com sucesso! ${palletLabel} baixado(s) do estoque.`);
      refreshCombinedData();
      
      // Auto-reorganize E/F stacks as many pallets might have left
      // We need to fetch latest state or at least calculate what happened.
      // Since individual updateSlot calls happened in the loop, let's use a fresh get logic or just trust state after dispatch.
      supabaseService.getInventoryPaginated(0, data.length || PAGE_SIZE).then(result => {
        supabaseService.getSlots().then(slt => {
           performStackReorganization(result.data, slt);
        });
      });
    } catch (error: any) {
      console.error('Error finalizing shipment:', error);
      showNotification(`Erro ao finalizar carregamento: ${error.message}`, 'error');
    }
  };

  const handleDeleteShipment = async (shipmentId: string) => {
    try {
      // 1. Captura os pallets vinculados ANTES de excluir, para saber quais tinham sido
      // marcados como AG VAGA (preShipmentSlot) enquanto faziam parte deste carregamento.
      const linkedPallets = await supabaseService.getInventoryItemsByShipmentId(shipmentId);

      await supabaseService.deleteShipment(shipmentId);
      setShipments(prev => prev.filter(s => s.id !== shipmentId));

      // 2. Para cada pallet que estava AG VAGA por causa deste carregamento, tenta devolvê-lo
      // à vaga de origem. Se essa vaga já estiver ocupada por outra coisa, ele permanece AG VAGA.
      for (const row of linkedPallets) {
        const inspections = row.inspections || [];
        let rowChanged = false;
        const restoredInspections = [...inspections];

        for (let idx = 0; idx < inspections.length; idx++) {
          const insp = inspections[idx];
          const sId = insp.shipmentId || (insp as any).shipment_id;
          if (sId !== shipmentId || !insp.preShipmentSlot) continue;

          const originalSlot = insp.preShipmentSlot;
          const slotNow = await supabaseService.getSlotById(originalSlot);
          const isFree = !slotNow || slotNow.status === SlotContent.EMPTY;
          rowChanged = true;

          if (isFree) {
            restoredInspections[idx] = { ...insp, assignedSlot: originalSlot, preShipmentSlot: undefined };
            if (slotNow) {
              await supabaseService.updateSlot({ ...slotNow, status: insp.contentType, occupiedBy: row.description });
            }
            await addToHistory({
              id: Math.random().toString(36).substring(2, 9),
              type: HistoryType.TRANSFER,
              timestamp: new Date().toLocaleString(),
              loadingId: row.loadingId,
              description: row.description,
              op: row.originOP,
              lot: row.lot,
              palletNumber: idx + 1,
              totalPallets: row.pallets,
              slot: originalSlot,
              details: `Carregamento ${shipmentId} excluído. Pallet retornou à vaga de origem ${originalSlot}.`,
              operatorName: user?.name,
              palletType: row.is_group ? 'CONSOLIDADO' : (insp.contentType ? translateSlotContent(insp.contentType) : 'Produto Acabado')
            }, true);
          } else {
            restoredInspections[idx] = { ...insp, preShipmentSlot: undefined };
            await addToHistory({
              id: Math.random().toString(36).substring(2, 9),
              type: HistoryType.TRANSFER,
              timestamp: new Date().toLocaleString(),
              loadingId: row.loadingId,
              description: row.description,
              op: row.originOP,
              lot: row.lot,
              palletNumber: idx + 1,
              totalPallets: row.pallets,
              slot: 'AGUARDANDO',
              details: `Carregamento ${shipmentId} excluído. Vaga de origem ${originalSlot} já está ocupada - pallet permanece AG VAGA.`,
              operatorName: user?.name,
              palletType: row.is_group ? 'CONSOLIDADO' : (insp.contentType ? translateSlotContent(insp.contentType) : 'Produto Acabado')
            }, true);
          }
        }

        if (rowChanged) {
          await supabaseService.saveInventoryItem({ ...row, inspections: restoredInspections });
        }
      }

      // 3. Atualiza inventário e vagas em tela
      const [result, freshSlots] = await Promise.all([
        supabaseService.getInventoryPaginated(0, data.length || PAGE_SIZE),
        supabaseService.getSlots()
      ]);
      setData(result.data);
      setSlots(freshSlots);

      showNotification('Carregamento excluído com sucesso.');
      refreshCombinedData();
    } catch (error: any) {
      console.error('Error deleting shipment:', error);
      showNotification(`Erro ao excluir carregamento: ${error.message}`, 'error');
    }
  };

  const togglePalletSelection = useCallback((rowId: string, palletIdx: number) => {
    const id = `${rowId}::${palletIdx}`;
    setSelectedPallets(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  }, []);

  /* Removed local stats memo in favor of server-side stats state */



  const handleManualAdd = async (palletData: any) => {
    try {
      const { description, op, lot, palletsCount, units, contentType, assignedSlot, supplyDetails, reworkObs, withoutSeal, datedBottles } = palletData;
      
      const count = palletsCount || 1;
      const totalUnits = Number(units) || 0;
      const unitsPerPallet = count > 0 ? totalUnits / count : 0;

      const newRow: SheetRow = {
        id: `ROW-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        loadingId: Math.random().toString(36).substring(2, 8).toUpperCase(),
        originOP: op,
        description,
        lot,
        pallets: count,
        status: StockStatus.INSPECTED,
        date: new Date().toLocaleDateString('pt-BR'),
        inspections: Array(count).fill(null).map(() => {
          let bottles = 0;
          let caps = 0;
          let boxes = 0;
          let cradles = 0;
          let others: { name: string; quantity: number }[] = [];

          if (contentType === SlotContent.SUPPLIES && supplyDetails) {
            bottles = supplyDetails.frascos || 0;
            caps = supplyDetails.tampas || 0;
            boxes = supplyDetails.caixas || 0;
            cradles = supplyDetails.bercos || 0;
            others = supplyDetails.extras || [];
          } else if (contentType === SlotContent.BOTTLES) {
            bottles = unitsPerPallet;
          } else if (contentType === SlotContent.FINISHED_PRODUCT) {
            boxes = unitsPerPallet;
          } else {
            boxes = unitsPerPallet;
          }

          return {
            bottles,
            caps,
            boxes,
            cradles,
            others,
            contentType,
            assignedSlot,
            isConsolidated: false,
            withoutSeal: !!withoutSeal,
            datedBottles: !!datedBottles,
            ...(reworkObs ? { reworkObs } : {})
          };
        }),
        operatorName: user?.name
      };
      
      if (assignedSlot !== 'AGUARDANDO') {
         const targetSlot = slots.find(s => s.id === assignedSlot);
         if (targetSlot) {
            const updatedSlot = {
              ...targetSlot,
              status: contentType,
              occupiedBy: description
            };
            await supabaseService.updateSlot(updatedSlot);
            setSlots(prev => prev.map(s => s.id === assignedSlot ? updatedSlot : s));
         }
      }
      
      await supabaseService.saveInventoryItem(newRow);
      setData(prev => [newRow, ...prev]);

      await addToHistory({
        ...createHistoryEntry(HistoryType.ENTRY, newRow, `Entrada manual: ${count} pallet(s)`, 1),
        slot: assignedSlot
      });
      
      showNotification('Pallet adicionado com sucesso!');
      refreshCombinedData();
    } catch (error) {
       console.error('Error adding pallet manually:', error);
       showNotification('Erro ao adicionar pallet manualmente', 'error');
       throw error;
    }
  };

  const handleAddUncatalogedPalletToShipment = async (palletData: any, shipmentId: string) => {
    try {
      const { description, op, lot, palletsCount, units, contentType, assignedSlot, supplyDetails, reworkObs, withoutSeal, datedBottles } = palletData;
      
      const count = Math.max(1, Number(palletsCount) || 1);
      const totalUnits = Number(units) || 0;
      const unitsPerPallet = count > 0 ? totalUnits / count : 0;

      const newRow: SheetRow = {
        id: `ROW-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        loadingId: Math.random().toString(36).substring(2, 8).toUpperCase(),
        originOP: op,
        description,
        lot,
        pallets: count,
        status: StockStatus.INSPECTED,
        date: new Date().toLocaleDateString('pt-BR'),
        inspections: Array(count).fill(null).map(() => {
          let bottles = 0;
          let caps = 0;
          let boxes = 0;
          let cradles = 0;
          let others: { name: string; quantity: number }[] = [];

          if (contentType === SlotContent.SUPPLIES && supplyDetails) {
            bottles = supplyDetails.frascos || 0;
            caps = supplyDetails.tampas || 0;
            boxes = supplyDetails.caixas || 0;
            cradles = supplyDetails.bercos || 0;
            others = supplyDetails.extras || [];
          } else if (contentType === SlotContent.BOTTLES) {
            bottles = unitsPerPallet;
          } else if (contentType === SlotContent.FINISHED_PRODUCT) {
            boxes = unitsPerPallet;
          } else {
            boxes = unitsPerPallet;
          }

          return {
            bottles,
            caps,
            boxes,
            cradles,
            others,
            contentType,
            assignedSlot,
            shipmentId: shipmentId, // Linked directly to this shipment
            isConsolidated: false,
            withoutSeal: !!withoutSeal,
            datedBottles: !!datedBottles,
            ...(reworkObs ? { reworkObs } : {})
          };
        }),
        operatorName: user?.name
      };
      
      if (assignedSlot && assignedSlot !== 'AGUARDANDO') {
         const targetSlot = slots.find(s => s.id === assignedSlot);
         if (targetSlot) {
            const updatedSlot = {
              ...targetSlot,
              status: contentType,
              occupiedBy: description
            };
            await supabaseService.updateSlot(updatedSlot);
            setSlots(prev => prev.map(s => s.id === assignedSlot ? updatedSlot : s));
         }
      }
      
      await supabaseService.saveInventoryItem(newRow);
      setData(prev => [newRow, ...prev]);

      await addToHistory({
        ...createHistoryEntry(HistoryType.ENTRY, newRow, `Entrada não catalogada vinculada ao carregamento #${shipmentId}: ${count} pallet(s)`, 1),
        slot: assignedSlot,
        details: `Pallet avulso criado e vinculado ao carregamento #${shipmentId}`
      });
      
      showNotification(`Pallet adicionado ao carregamento ${shipmentId}!`);
      await fetchShipmentDetailPallets(shipmentId);
      refreshCombinedData();
    } catch (error: any) {
       console.error('Error adding uncataloged pallet to shipment:', error);
       showNotification(`Erro ao adicionar pallet ao carregamento: ${error.message || error}`, 'error');
       throw error;
    }
  };

  const handleUpdateShipmentObs = async (shipmentId: string, obs: string) => {
    try {
      const currentShipment = shipments.find(s => s.id === shipmentId) || shipmentDetailContext;
      if (!currentShipment) return;
      const updatedShipment = { ...currentShipment, obs };
      await supabaseService.saveShipment(updatedShipment);
      setShipments(prev => prev.map(s => s.id === shipmentId ? updatedShipment : s));
      if (shipmentDetailContext && shipmentDetailContext.id === shipmentId) {
        setShipmentDetailContext(updatedShipment);
      }
      showNotification('Observação do carregamento salva!');
    } catch (error: any) {
      console.error('Error updating shipment obs:', error);
      showNotification('Erro ao salvar observação', 'error');
      throw error;
    }
  };


  const handleMovementTransfer = async (transferData: any) => {
    try {
      const item = transferData.pallet;
      if (!item) return;
      const { fromSlot, toSlot } = transferData;

      if (fromSlot && fromSlot !== 'AGUARDANDO') {
        const otherPalletsInSlot = await supabaseService.findPalletsBySlot(fromSlot);
        if (otherPalletsInSlot.length <= 1) {
          const fromSlotObj = slots.find(s => s.id === fromSlot);
          if (fromSlotObj) {
            const updatedFrom = { ...fromSlotObj, status: 'VAZIO', occupiedBy: undefined };
            await supabaseService.updateSlot(updatedFrom);
            setSlots(prev => prev.map(s => s.id === fromSlot ? updatedFrom : s));
          }
        }
      }

      if (toSlot && toSlot !== 'AGUARDANDO') {
        const freshSlot = await supabaseService.getSlotById(toSlot);
        if (freshSlot && freshSlot.status !== SlotContent.EMPTY && (freshSlot.status as any) !== 'VAZIO' && freshSlot.occupiedBy && freshSlot.occupiedBy !== item.description) {
          showNotification(`A vaga ${toSlot} acabou de ser ocupada por outro operador (${freshSlot.occupiedBy}). Selecione outra vaga disponível.`, 'error');
          refreshCombinedData();
          return;
        }

        const targetSlotObj = slots.find(s => s.id === toSlot);
        if (targetSlotObj) {
          const updatedTo = {
            ...targetSlotObj,
            status: item.inspections?.[0]?.contentType || 'SUPPLIES',
            occupiedBy: item.description
          };
          await supabaseService.updateSlot(updatedTo);
          setSlots(prev => prev.map(s => s.id === toSlot ? updatedTo : s));
        }
      }

      const updatedRow = { ...item };
      if (updatedRow.inspections?.[0]) {
        updatedRow.inspections[0].assignedSlot = toSlot;
      }
      await supabaseService.saveInventoryItem(updatedRow);
      
      await addToHistory({
        ...createHistoryEntry(HistoryType.TRANSFER, item, `Transferência da vaga ${fromSlot || 'AGUARDANDO'} para ${toSlot}`),
        slot: toSlot
      });

      showNotification('Transferência realizada com sucesso!');
      refreshCombinedData();
    } catch (error) {
      console.error(error);
      showNotification('Erro ao realizar transferência.', 'error');
    }
  };

  const handleMovementExit = async (exitData: any) => {
    try {
      const item = exitData.pallet;
      if (!item) return;
      const fromSlot = item.inspections?.[0]?.assignedSlot;

      if (fromSlot && fromSlot !== 'AGUARDANDO') {
        const otherPalletsInSlot = await supabaseService.findPalletsBySlot(fromSlot);
        if (otherPalletsInSlot.length <= 1) {
          const fromSlotObj = slots.find(s => s.id === fromSlot);
          if (fromSlotObj) {
            const updatedFrom = { ...fromSlotObj, status: 'VAZIO', occupiedBy: undefined };
            await supabaseService.updateSlot(updatedFrom);
            setSlots(prev => prev.map(s => s.id === fromSlot ? updatedFrom : s));
          }
        }
      }

      await supabaseService.deleteInventoryItem(item.id);

      await addToHistory({
        ...createHistoryEntry(HistoryType.EXIT, item, `Saída operacional. Motivo: ${exitData.reason}`),
        slot: fromSlot
      });

      showNotification('Saída registrada com sucesso!');
      refreshCombinedData();
    } catch (error) {
      console.error(error);
      showNotification('Erro ao registrar saída.', 'error');
    }
  };

  const handleUpdatePallet = async (updatedData: { 
    description: string; 
    op: string; 
    lot: string; 
    quantity: number;
    contentType: SlotContent;
    assignedSlot?: string;
    reason?: string;
    withoutSeal?: boolean;
    datedBottles?: boolean;
    supplyDetails?: {
      bottles: number;
      caps: number;
      boxes: number;
      cradles: number;
      others: { name: string; quantity: number }[];
    }
  }) => {
    if (!editPalletContext) return;

    try {
      const { row, idx } = editPalletContext;
      
      const updatedInspections = [...(row.inspections || [])];
      if (updatedInspections[idx]) {
        const isSuppliesType = updatedData.contentType === SlotContent.SUPPLIES;
        const isBottlesType = updatedData.contentType === SlotContent.BOTTLES;

        updatedInspections[idx] = {
          ...updatedInspections[idx],
          contentType: updatedData.contentType,
          assignedSlot: updatedData.assignedSlot || updatedInspections[idx].assignedSlot,
          withoutSeal: updatedData.withoutSeal !== undefined ? updatedData.withoutSeal : updatedInspections[idx].withoutSeal,
          datedBottles: updatedData.datedBottles !== undefined ? updatedData.datedBottles : updatedInspections[idx].datedBottles,
          ...(isSuppliesType && updatedData.supplyDetails ? updatedData.supplyDetails : {}),
          ...(isBottlesType ? { bottles: updatedData.quantity, boxes: 0 } : {}),
          ...(!isSuppliesType && !isBottlesType ? { boxes: updatedData.quantity, bottles: 0 } : {})
        };
      }

      const updatedRow: SheetRow = { 
        ...row,
        description: updatedData.description,
        originOP: updatedData.op,
        lot: updatedData.lot,
        pallets: updatedData.quantity,
        inspections: updatedInspections,
        operatorName: user?.name
      };

      // Check if it's an operator requesting a change
      if (user?.role === 'operator' && editPalletMode === 'edit') {
        const { id: inventory_id } = row;
        
        await supabaseService.createEditRequest({
          inventory_id: inventory_id,
          requested_by: user.id,
          before_data: row,
          after_data: updatedRow,
          reason: updatedData.reason || 'Alteração de dados do pallet'
        });

        showNotification('Solicitação de alteração enviada para aprovação do administrador!');
        setEditPalletContext(null);
        return;
      }

      // Admin direct edit or Assignment mode logic
      // If a slot was assigned (moved from AGUARDANDO to a real slot)
      if (updatedData.assignedSlot && updatedData.assignedSlot !== 'AGUARDANDO' && row.inspections?.[idx].assignedSlot === 'AGUARDANDO') {
        const targetSlot = slots.find(s => s.id === updatedData.assignedSlot);
        if (targetSlot) {
          const updatedSlot: WarehouseSlot = {
            ...targetSlot,
            status: updatedData.contentType,
            occupiedBy: updatedData.op || updatedRow.description
          };
          await supabaseService.updateSlot(updatedSlot);
          setSlots(prev => prev.map(s => s.id === updatedData.assignedSlot ? updatedSlot : s));
          
          // Add to history
          await addToHistory({
            ...createHistoryEntry(HistoryType.ALLOCATION, updatedRow, `Alocação via Aguardando Vaga para ${updatedData.assignedSlot}`, idx + 1),
            slot: updatedData.assignedSlot
          });
        }
      } else {
        // Regular Edit
        await addToHistory(createHistoryEntry(HistoryType.EDIT, updatedRow, `Edição de dados do pallet por ${user?.name || 'Operador'}`, idx + 1));
      }

      await supabaseService.saveInventoryItem(updatedRow);
      setData(prev => prev.map(r => r.id === updatedRow.id ? updatedRow : r));
      
      showNotification('Dados do pallet atualizados com sucesso!');
      setEditPalletContext(null);
      refreshCombinedData();

      // Auto-reorganize E/F stacks in case OP/Description changed
      performStackReorganization(data.map(r => r.id === updatedRow.id ? updatedRow : r), slots);
    } catch (error: any) {
      console.error('Update error:', error);
      showNotification('Erro ao atualizar pallet', 'error');
    }
  };

  const confirmDelete = async () => {
    if (!deleteContext) return;
    try {
      if (deleteContext.type === 'row') {
        const row = data.find(r => r.id === deleteContext.rowId) || pendingRows.find(r => r.id === deleteContext.rowId);
        if (row) {
          await addToHistory(createHistoryEntry(HistoryType.REMOVAL, row, `Remoção total da OP ${row.originOP} por ${user?.name || 'Operador'}`));
        }
        await supabaseService.deleteInventoryItem(deleteContext.rowId);
        setData(prev => prev.filter(item => item.id !== deleteContext.rowId));
      } else if (deleteContext.type === 'pallet' && deleteContext.palletIdx !== undefined) {
        const row = data.find(r => r.id === deleteContext.rowId) || pendingRows.find(r => r.id === deleteContext.rowId);
        if (row && row.inspections) {
          const inspection = row.inspections[deleteContext.palletIdx];
          await addToHistory(createHistoryEntry(HistoryType.REMOVAL, row, 'Remoção de pallet', deleteContext.palletIdx + 1));
          
          if (inspection.assignedSlot && inspection.assignedSlot !== 'AGUARDANDO') {
            await supabaseService.freeSlot(inspection.assignedSlot);
            setSlots(prev => prev.map(s => s.id === inspection.assignedSlot ? { ...s, status: SlotContent.EMPTY, occupiedBy: undefined } : s));
          }

          const updatedInsps = row.inspections?.filter((_, i) => i !== deleteContext.palletIdx);
          if (updatedInsps?.length === 0) {
            await supabaseService.deleteInventoryItem(row.id);
            setData(prev => prev.filter(r => r.id !== row.id));
          } else {
            const updatedRow = { 
              ...row, 
              inspections: updatedInsps, 
              
              status: row.status 
            };
            await supabaseService.saveInventoryItem(updatedRow);
            setData(prev => prev.map(r => r.id === deleteContext.rowId ? updatedRow : r));
          }
          
          // Auto-reorganize E/F stacks
          const finalData = (updatedInsps?.length === 0) 
            ? data.filter(r => r.id !== row.id)
            : data.map(r => r.id === deleteContext.rowId ? { ...row, inspections: updatedInsps, } : r);
          const finalSlots = inspection.assignedSlot ? slots.map(s => s.id === inspection.assignedSlot ? { ...s, status: SlotContent.EMPTY, occupiedBy: undefined } : s) : slots;
          performStackReorganization(finalData, finalSlots);
        }
      }
      setDeleteContext(null);
      refreshCombinedData();
    } catch (error) {
      console.error('Error deleting:', error);
      showNotification('Erro ao excluir no servidor.', 'error');
    }
  };

  const confirmMatrixSend = async () => {
    if (!matrixConfirmContext) return;
    const { rowId, palletIdx, slotId } = matrixConfirmContext;
    const row = data.find(r => r.id === rowId) || pendingRows.find(r => r.id === rowId);
    if (!row || !row.inspections) return;

    try {
      const inspection = row.inspections[palletIdx];
      await addToHistory(createRecoverableExitEntry(row, inspection, 'Enviado para Matriz', palletIdx + 1));
      
      if (slotId && slotId !== 'AGUARDANDO') {
        await supabaseService.freeSlot(slotId);
        setSlots(prev => prev.map(s => s.id === slotId ? { ...s, status: SlotContent.EMPTY, occupiedBy: undefined } : s));
      }
      
      const newInsps = row.inspections?.filter((_, i) => i !== palletIdx);
      if (newInsps?.length === 0) {
        await supabaseService.deleteInventoryItem(rowId);
        setData(prev => prev.filter(r => r.id !== rowId));
      } else {
        const updatedRow = { 
          ...row, 
          inspections: newInsps, 
          
          status: row.status 
        };
        await supabaseService.saveInventoryItem(updatedRow);
        setData(prev => prev.map(r => r.id === rowId ? updatedRow : r));
      }

      showNotification(`A OP ${row.originOP} foi enviada para matriz com sucesso`);
      setMatrixConfirmContext(null);
      refreshCombinedData();

      // Auto-reorganize E/F stacks
      const finalData = (newInsps?.length === 0) 
        ? data.filter(r => r.id !== rowId)
        : data.map(r => r.id === rowId ? { ...row, inspections: newInsps, } : r);
      const finalSlots = slotId ? slots.map(s => s.id === slotId ? { ...s, status: SlotContent.EMPTY, occupiedBy: undefined } : s) : slots;
      performStackReorganization(finalData, finalSlots);
    } catch (error) {
      console.error('Error sending to matrix:', error);
      showNotification('Erro ao processar envio no servidor.', 'error');
    }
  };

  const handleBulkSend = async () => {
    try {
      const updatedSlots: WarehouseSlot[] = [...slots];
      
      const rowIds = Array.from(new Set(selectedPallets.map(key => key.split('::').slice(0, -1).join('::'))));
      const itemsToProcess = await supabaseService.getInventoryItemsByIds(rowIds as string[]);
      const rowsToUpdate: Map<string, SheetRow> = new Map();

      for (const key of selectedPallets) {
        const parts = key.split('::');
        const rowId = parts.slice(0, parts.length - 1).join('::');
        const palletIdx = parseInt(parts[parts.length - 1]);
        
        const row = itemsToProcess.find(r => r.id === rowId);
        if (row && row.inspections) {
          const inspection = row.inspections[palletIdx];
          if (!inspection) continue;

          await addToHistory(createRecoverableExitEntry(row, inspection, 'Saída em massa', palletIdx + 1), true);
          
          if (inspection.assignedSlot) {
            const slotIdx = updatedSlots.findIndex(s => s.id === inspection.assignedSlot);
            if (slotIdx !== -1) {
              updatedSlots[slotIdx] = { ...updatedSlots[slotIdx], status: SlotContent.EMPTY, occupiedBy: undefined };
            }
          }

          // Track row updates
          const currentRow = rowsToUpdate.get(rowId) || { ...row };
          const rowSelectedIndices = selectedPallets
            .filter(k => k.startsWith(`${rowId}::`))
            .map(k => {
              const p = k.split('::');
              return parseInt(p[p.length - 1]);
            });
          
          const newInsps = row.inspections?.filter((_, i) => !rowSelectedIndices.includes(i));
          currentRow.inspections = newInsps;
          currentRow.pallets = newInsps?.length || 0;
          rowsToUpdate.set(rowId, currentRow);
        }
      }

      // Bulk update slots and rows in Supabase
      const slotUpdatePromise = supabaseService.bulkUpdateSlots(updatedSlots);
      
      const inventoryUpdatePromises = Array.from(rowsToUpdate.values()).map(row => {
        if (row.inspections && row.inspections.length === 0) {
          return supabaseService.deleteInventoryItem(row.id);
        } else {
          return supabaseService.saveInventoryItem(row);
        }
      });

      await Promise.all([slotUpdatePromise, ...inventoryUpdatePromises]);

      setSlots(updatedSlots);
      
      // Update local state: remove rows with 0 inspections
      setData(prev => {
        const nextData = prev
          .map(row => rowsToUpdate.has(row.id) ? rowsToUpdate.get(row.id)! : row)
          .filter(row => (row.inspections?.length || 0) > 0);
        return nextData;
      });

      showNotification(`${selectedPallets.length} pallets enviados com sucesso`);
      
      setSelectedPallets([]);
      setIsBulkConfirmOpen(false);
      refreshCombinedData();
      
      // Auto-reorganize E/F stacks
      const finalData = data
        .map(row => rowsToUpdate.has(row.id) ? rowsToUpdate.get(row.id)! : row)
        .filter(row => (row.inspections?.length || 0) > 0);
      performStackReorganization(finalData, updatedSlots);
    } catch (error) {
      console.error('Error in bulk send:', error);
      showNotification('Erro ao processar envio em massa no servidor.', 'error');
    }
  };

  const handleSendToMatrix = useCallback((rowId: string, palletIdx: number, slotId?: string) => {
    setMatrixConfirmContext({ rowId, palletIdx, slotId });
  }, []);

  const handleShowDetail = useCallback((row: SheetRow, inspection: InspectionData, idx: number) => {
    setDetailContext({ row, inspection, idx });
  }, []);

  const [isUnconsolidating, setIsUnconsolidating] = useState(false);
  const handleUnconsolidate = useCallback(async (groupId: string) => {
    setIsUnconsolidating(true);
    try {
      const historyId = crypto.randomUUID();
      await supabaseService.unconsolidatePallets(groupId, historyId, user?.id || null, user?.name || 'Operador');
      showNotification('Grupo desconsolidado com sucesso!', 'success');
      setDetailContext(null);
      const refreshEvent = new CustomEvent('refresh-inventory');
      window.dispatchEvent(refreshEvent);
      const refreshEventDash = new CustomEvent('refresh-dashboard');
      window.dispatchEvent(refreshEventDash);
    } catch (error: any) {
      console.error('Error unconsolidating:', error);
      showNotification(error.message || 'Erro ao desconsolidar grupo', 'error');
    } finally {
      setIsUnconsolidating(false);
    }
  }, [user, showNotification]);

  const handleEditPallet = useCallback((row: SheetRow, inspection: InspectionData, idx: number) => {
    setEditPalletMode('edit');
    setEditPalletContext({ row, inspection, idx });
  }, []);

  const handleDeletePallet = useCallback((rowId: string, idx: number) => {
    setDeleteContext({ type: 'pallet', rowId, palletIdx: idx });
  }, []);

  const RackView = ({ rack }: { rack: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' }) => {
    const rackSlots = slots.filter(s => s.rack === rack);
    const freeCount = rackSlots.filter(s => s.status === SlotContent.EMPTY).length;
    const totalCount = rackSlots.length;
    
    const rackTitles = {
      'A': 'Frascos (G0)',
      'B': 'Insumos / Acabados',
      'C': 'Insumos / Acabados',
      'D': 'Outros / Acabados',
      'E': 'Containers',
      'F': 'Containers'
    };

    return (
      <div className="bg-slate-100 dark:bg-slate-900/40 p-5 md:p-8 rounded-[2.5rem] border border-slate-300 dark:border-slate-800/50 shadow-2xl overflow-hidden mb-6">
        <div className="flex flex-wrap justify-between items-center mb-6 gap-4">
          <div className="flex items-center gap-3">
             <div className={`w-1.5 h-8 rounded-full ${
               rack === 'D' ? 'bg-green-600' : 
               rack === 'A' ? 'bg-blue-600' : 
               (rack === 'E' || rack === 'F') ? 'bg-purple-600' :
               'bg-amber-600'
             }`}></div>
             <div className="flex flex-col">
                <h4 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tighter flex items-center gap-2">
                  Porta Pallet {rack} <span className="text-slate-600 dark:text-slate-500 font-medium text-sm">/ {rackTitles[rack]}</span>
                </h4>
                <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest">Topografia Interna</p>
             </div>
          </div>
          
          <div className="bg-slate-50/50 dark:bg-slate-950/50 px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-800/50 flex items-center gap-6">
            <div className="flex flex-col items-center">
              <span className="text-[8px] text-slate-600 font-bold uppercase mb-0.5">Livres</span>
              <span className="text-sm font-black text-blue-500">{freeCount}</span>
            </div>
            <div className="w-px h-6 bg-slate-200 dark:bg-slate-800/50"></div>
            <div className="flex flex-col items-center">
              <span className="text-[8px] text-slate-600 font-bold uppercase mb-0.5">Total</span>
              <span className="text-sm font-black text-slate-900 dark:text-white">{totalCount}</span>
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-2">
          {rackSlots.map(slot => {
            const isContainer = slot.status === SlotContent.CONTAINER_SJ || 
                              slot.status === SlotContent.CONTAINER_LP || 
                              slot.status === SlotContent.CONTAINER_CP;
            
            const containerColor = getContainerColor(slot.status);

            const isRotative = slot.status === SlotContent.ROTATIVE;
            const ContentIcon = slot.status === SlotContent.EMPTY ? undefined : 
                               slot.status === SlotContent.BOTTLES ? FlaskConical : 
                               slot.status === SlotContent.FINISHED_PRODUCT ? Truck : 
                               (slot.status === SlotContent.REWORK || slot.status === SlotContent.REPROCESS) ? RefreshCw :
                               isContainer ? Container :
                               isRotative ? TrendingUp :
                               Package;
            
            return (
              <div 
                key={slot.id} 
                onClick={() => {
                  setSelectedMappingSlot(slot);
                }}
                className={`aspect-square rounded-xl border flex flex-col items-center justify-center p-1 transition-all group relative cursor-pointer ${
                slot.status === SlotContent.EMPTY ? 'bg-slate-50/30 dark:bg-slate-950/30 border-slate-300 dark:border-slate-800/50 hover:border-slate-700' : 
                slot.status === SlotContent.BOTTLES ? 'bg-blue-600/10 border-blue-600/30' : 
                slot.status === SlotContent.SUPPLIES ? 'bg-amber-600/10 border-amber-600/30' :
                isContainer ? 'bg-slate-300/10 border-slate-100/30' :
                (slot.status === SlotContent.REWORK || slot.status === SlotContent.REPROCESS) ? 'bg-purple-600/10 border-purple-600/30' :
                isRotative ? 'bg-indigo-600/10 border-indigo-600/30 shadow-[inset_0_0_10px_rgba(79,70,229,0.1)]' :
                'bg-green-600/10 border-green-600/30'
              }`}>
                <span className="text-[7px] font-bold text-slate-600 mb-1">{slot.id.split('.').slice(1).join('.')}</span>
                {ContentIcon ? (
                  <ContentIcon className={`w-3.5 h-3.5 ${
                    slot.status === SlotContent.BOTTLES ? 'text-blue-500' : 
                    slot.status === SlotContent.SUPPLIES ? 'text-amber-500' :
                    isContainer ? containerColor :
                    (slot.status === SlotContent.REWORK || slot.status === SlotContent.REPROCESS) ? 'text-purple-500' :
                    isRotative ? 'text-indigo-500' :
                    'text-green-500'
                  }`} />
                ) : (
                  <div className="w-1 h-1 rounded-full bg-slate-100 dark:bg-slate-800 group-hover:bg-slate-700 transition-colors"></div>
                )}
                
                {isRotative && (
                   <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-indigo-600 rounded-full border border-slate-950 z-20 shadow-lg"></div>
                )}
                {slot.occupiedBy && (
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-slate-100 dark:bg-slate-900/95 backdrop-blur-sm rounded-xl flex items-center justify-center z-10 transition-opacity border border-slate-700 p-1">
                    <span className="text-[7px] font-bold text-slate-900 dark:text-white text-center leading-tight line-clamp-3">{slot.occupiedBy}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };



  const filteredInventory = useMemo(() => {
    // Only calculate if we are on the inventory tab or shipments or needed for bulk
    if (activeTab !== 'inventory' && activeTab !== 'shipments' && !isBulkConfirmOpen) return [];
    
    const start = performance.now();
    const term = (inventorySearch || '').toLowerCase().trim();
    const inspectedItems = data.filter(item => item.status === StockStatus.INSPECTED);
    const allPallets: { row: SheetRow, inspection: InspectionData, idx: number }[] = [];
    
    inspectedItems.forEach(item => {
      item.inspections?.forEach((insp, idx) => {
        // Search term check
        
        const isSemSeloSearch = term === 'sem selo' || term === 'sem-selo';
        const isDatadoSearch = term === 'datado' || term === 'datados' || term === 'frasco datado' || term === 'frascos datados';
        const isSlotSearch = /^[a-fA-F](\.\d+){0,2}$/.test(term);
        
        let matchesSearch = true;
        if (term) {
           if (isSemSeloSearch) {
              matchesSearch = insp.withoutSeal === true;
           } else if (isDatadoSearch) {
              matchesSearch = insp.datedBottles === true;
           } else if (isSlotSearch) {
              matchesSearch = (insp.assignedSlot || '').toLowerCase().includes(term);
           }
        }

        // Type filter check
        const matchesType = inventoryTypeFilter === 'ALL' || 
          (inventoryTypeFilter === 'SEM_SELO' && insp.withoutSeal) ||
          (inventoryTypeFilter === 'DATADOS' && insp.datedBottles) ||
          insp.contentType === inventoryTypeFilter ||
          (inventoryTypeFilter === 'CONTAINER' && [SlotContent.CONTAINER_SJ, SlotContent.CONTAINER_LP, SlotContent.CONTAINER_CP].includes(insp.contentType));

        if (matchesSearch && matchesType) {
          allPallets.push({ row: item, inspection: insp, idx });
        }
      });
    });
    
    const sorted = allPallets.sort((a, b) => {
      // Sort by date descending (most recent first)
      const dateA = new Date(a.row.date).getTime();
      const dateB = new Date(b.row.date).getTime();
      
      if (dateB !== dateA) {
        return dateB - dateA;
      }
      
      // Secondary sort by slot
      const slotA = a.inspection.assignedSlot || '';
      const slotB = b.inspection.assignedSlot || '';
      return slotA.localeCompare(slotB, undefined, { numeric: true });
    });
    
    const end = performance.now();
    console.log(`[Performance] filteredInventory re-calculated in ${(end - start).toFixed(2)}ms for ${sorted.length} items`);
    return sorted;
  }, [data, inventorySearch, inventoryTypeFilter, activeTab, isBulkConfirmOpen]);

  
  const appNotifications = [
    ...(user?.role === 'admin' && pendingApprovalsCount > 0 ? [{ id: 'approvals', label: 'Aprovações Pendentes', count: pendingApprovalsCount, tab: 'approvals', icon: ClipboardCheck }] : []),
    ...(pendingRows.length > 0 ? [{ id: 'analysis', label: 'Análises Pendentes', count: pendingRows.length, tab: 'analysis', icon: ClipboardCheck }] : []),
    ...(shipments.filter(s => s.status === ShipmentStatus.OPEN).length > 0 ? [{ id: 'shipments', label: 'Carregamentos Abertos', count: shipments.filter(s => s.status === ShipmentStatus.OPEN).length, tab: 'shipments', icon: Truck }] : []),
    ...(warehouseDiagnostic && warehouseDiagnostic.slotConflicts > 0 ? [{ id: 'conflicts', label: 'Vagas em Conflito', count: warehouseDiagnostic.slotConflicts, tab: 'map', icon: AlertCircle, action: () => setIsDiagnosticDetailsOpen(true) }] : []),
    ...(warehouseDiagnostic && warehouseDiagnostic.freeSlotsWithPallets > 0 ? [{ id: 'free-slots', label: 'Vagas Não Marcadas', count: warehouseDiagnostic.freeSlotsWithPallets, tab: 'map', icon: AlertCircle, action: () => setIsDiagnosticDetailsOpen(true) }] : [])
  ];
  const totalAppNotifications = appNotifications.length;

  if (isAuthLoading) {

    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-[10px] font-black text-slate-600 dark:text-slate-500 uppercase tracking-[0.3em]">Carregando Stoque+</p>
        </div>
      </div>
    );
  }

  if (!user && !isPublicView) {
    return <Login onLoginSuccess={async () => {
      const currentUser = await supabaseService.getCurrentUser();
      setUser(currentUser);
    }} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 flex flex-col lg:flex-row font-sans selection:bg-blue-600/30 overflow-x-hidden">
      
      
      {/* Update Available Modal */}
      <AnimatePresence>
        {updateAvailable && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={reloadPage}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-6 md:p-8 shadow-2xl border border-slate-200 dark:border-slate-800 text-center"
            >
              <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center mx-auto mb-6">
                <RefreshCw className="w-8 h-8 animate-spin" />
              </div>
              <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">Nova Atualização!</h3>
              <p className="text-slate-600 dark:text-slate-400 mb-8">
                Lançamos uma nova versão do Stoque+ com melhorias e correções. Clique no botão abaixo para recarregar a página e utilizar a nova versão.
              </p>
              
              <button
                onClick={reloadPage}
                className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-slate-900 dark:text-white font-bold rounded-2xl transition-all shadow-lg shadow-blue-900/20 active:scale-[0.98]"
              >
                Recarregar e Atualizar
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Slot Actions Modal */}
      <AnimatePresence>
        {selectedMappingSlot && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedMappingSlot(null)}
              className="absolute inset-0 bg-slate-50/90 dark:bg-slate-950/90 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl relative z-10 space-y-6"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase italic tracking-tight">Ações da Vaga</h3>
                  <p className="text-[10px] text-slate-600 dark:text-slate-500 font-bold uppercase tracking-widest mt-1">Vaga {selectedMappingSlot.id}</p>
                </div>
                <button onClick={() => setSelectedMappingSlot(null)} className="p-2 hover:bg-slate-100 dark:bg-slate-800 rounded-xl transition-colors">
                  <X className="w-5 h-5 text-slate-600" />
                </button>
              </div>

              <div className="space-y-3">
                {selectedMappingSlot.status === SlotContent.EMPTY && (
                  <button 
                    onClick={() => handleDedicateSlot(selectedMappingSlot)}
                    className="w-full px-6 py-4 bg-indigo-600 hover:bg-indigo-500 text-slate-900 dark:text-white rounded-2xl font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all"
                  >
                    <TrendingUp className="w-4 h-4" /> Dedicar ao Rotativo
                  </button>
                )}

                {selectedMappingSlot.status === SlotContent.ROTATIVE && (
                  <>
                    <button 
                      onClick={() => {
                        navigateToTab('rotative');
                        setSelectedMappingSlot(null);
                      }}
                      className="w-full px-6 py-4 bg-blue-600 hover:bg-blue-500 text-slate-900 dark:text-white rounded-2xl font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all"
                    >
                      <Search className="w-4 h-4" /> Ver Estoque Rotativo
                    </button>
                    <button 
                      onClick={() => handleReleaseSlot(selectedMappingSlot)}
                      className="w-full px-6 py-4 bg-slate-100 dark:bg-slate-800 hover:bg-red-600/20 text-slate-500 dark:text-slate-400 hover:text-red-500 border border-slate-200 dark:border-slate-800 hover:border-red-500/30 rounded-2xl font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all"
                    >
                      <Trash2 className="w-4 h-4" /> Remover Dedicação
                    </button>
                  </>
                )}

                {![SlotContent.EMPTY, SlotContent.ROTATIVE].includes(selectedMappingSlot.status as any) && (
                  <div className="bg-slate-50 dark:bg-slate-950 p-6 rounded-2xl border border-slate-200 dark:border-slate-800">
                    <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest mb-2 text-center">Ocupado por</p>
                    <p className="text-slate-900 dark:text-white font-black uppercase text-center text-sm">{selectedMappingSlot.occupiedBy || 'N/A'}</p>
                  </div>
                )}
              </div>

              <button 
                onClick={() => setSelectedMappingSlot(null)}
                className="w-full px-6 py-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-750 text-slate-600 dark:text-slate-500 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all"
              >
                Voltar ao Mapa
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 md:top-6 md:right-6 z-[200] flex flex-col gap-3 pointer-events-none w-full max-w-[90%] md:max-w-sm">
        {notifications.map(n => (
          <div key={n.id} className={`bg-white dark:bg-slate-900 border ${n.type === 'error' ? 'border-red-500/30' : 'border-green-500/30'} text-slate-900 dark:text-white px-4 md:px-6 py-3 md:py-4 rounded-2xl shadow-2xl flex items-center gap-4 animate-in slide-in-from-right duration-300 pointer-events-auto`}>
            <div className={`w-8 h-8 md:w-10 md:h-10 ${n.type === 'error' ? 'bg-red-500/10 text-red-500 border-red-500/20' : 'bg-green-500/10 text-green-500 border-green-500/20'} rounded-xl flex items-center justify-center border shrink-0`}>
              {n.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            </div>
            <p className="text-xs md:text-sm font-black uppercase tracking-tight line-clamp-2">{n.message}</p>
          </div>
        ))}
      </div>

      {/* Sidebar Mobile Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-50/80 dark:bg-slate-950/80 backdrop-blur-sm z-40 lg:hidden animate-in fade-in duration-300"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      {!isPublicView && (
        <aside className={`fixed lg:sticky top-0 left-0 h-screen w-72 ${isSidebarCollapsed ? 'lg:w-20' : 'lg:w-72'} bg-slate-100 dark:bg-slate-900/80 backdrop-blur-xl border-r border-slate-200 dark:border-slate-800 shadow-2xl z-50 transition-all duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} flex-shrink-0 flex flex-col`}>
          <div className={`border-b border-slate-300 dark:border-slate-800/60 flex items-center justify-between ${isSidebarCollapsed ? 'p-4' : 'p-8'}`}>
            {/* Logo completa: sempre visível no mobile; some no desktop quando recolhida */}
            <div className={`min-w-0 ${isSidebarCollapsed ? 'lg:hidden' : ''}`}>
              <Logo />
            </div>
            {/* Logo ícone-only: só aparece no desktop, quando recolhida */}
            <div className={`hidden items-center justify-center w-full ${isSidebarCollapsed ? 'lg:flex' : ''}`}>
              <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20 shrink-0">
                <Warehouse className="w-5 h-5 text-slate-900 dark:text-white" />
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-slate-600 dark:text-slate-500 hover:text-slate-900 dark:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
              <button
                onClick={() => setIsSidebarCollapsed(prev => !prev)}
                className={`hidden lg:flex items-center justify-center p-1.5 rounded-lg text-slate-600 dark:text-slate-500 hover:text-slate-900 dark:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors ${isSidebarCollapsed ? 'ml-0' : 'ml-1'}`}
                title={isSidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
              >
                {isSidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <nav className={`py-6 space-y-1 flex-1 overflow-y-auto ${isSidebarCollapsed ? 'px-4 lg:px-3' : 'px-4'}`}>
            <NavItem tab="dashboard" icon={LayoutDashboard} label="Dashboard" isActive={activeTab === 'dashboard'} activeTab={activeTab} onNavigate={(t) => { setIsSidebarOpen(false); navigateToTab(t); }} isCollapsed={isSidebarCollapsed} />
            <NavItem tab="quicksearch" icon={Search} label="Consulta Rápida" isActive={activeTab === 'quicksearch'} activeTab={activeTab} onNavigate={(t) => { setIsSidebarOpen(false); navigateToTab(t); }} isCollapsed={isSidebarCollapsed} />
            <NavItem tab="waiting" icon={Clock} label="Aguardando Vaga" badge={stats.waitingPallets} isActive={activeTab === 'waiting'} activeTab={activeTab} onNavigate={(t) => { setIsSidebarOpen(false); navigateToTab(t); }} isCollapsed={isSidebarCollapsed} />
            
            <NavItem tab="inventory" icon={Package} label="Estoque Geral" isActive={activeTab === 'inventory'} activeTab={activeTab} onNavigate={(t) => { setIsSidebarOpen(false); navigateToTab(t); }} isCollapsed={isSidebarCollapsed} />
            <NavItem tab="rotative" icon={TrendingUp} label="Estoque Rotativo" isActive={activeTab === 'rotative'} activeTab={activeTab} onNavigate={(t) => { setIsSidebarOpen(false); navigateToTab(t); }} isCollapsed={isSidebarCollapsed} />
            <NavItem tab="shipments" icon={Truck} label="Carregamento" badge={shipments.filter(s => s.status === ShipmentStatus.OPEN).length} isActive={activeTab === 'shipments'} activeTab={activeTab} onNavigate={(t) => { setIsSidebarOpen(false); navigateToTab(t); }} isCollapsed={isSidebarCollapsed} />
            <NavItem tab="map" icon={Warehouse} label="Mapa de vagas" isActive={activeTab === 'map'} activeTab={activeTab} onNavigate={(t) => { setIsSidebarOpen(false); navigateToTab(t); }} isCollapsed={isSidebarCollapsed} />
            <NavItem tab="analysis" icon={ClipboardCheck} label="Análise" badge={pendingRows.length} isActive={activeTab === 'analysis'} activeTab={activeTab} onNavigate={(t) => { setIsSidebarOpen(false); navigateToTab(t); }} isCollapsed={isSidebarCollapsed} />
            <NavItem tab="history" icon={History} label="Histórico" isActive={activeTab === 'history'} activeTab={activeTab} onNavigate={(t) => { setIsSidebarOpen(false); navigateToTab(t); }} isCollapsed={isSidebarCollapsed} />
            {user?.role === 'admin' && (
              <>
                <NavItem tab="approvals" icon={ClipboardCheck} label="Aprovações" badge={pendingApprovalsCount} isActive={activeTab === 'approvals'} activeTab={activeTab} onNavigate={(t) => { setIsSidebarOpen(false); navigateToTab(t); }} isCollapsed={isSidebarCollapsed} />
                <NavItem tab="users" icon={Users} label="Admin" isActive={activeTab === 'users'} activeTab={activeTab} onNavigate={(t) => { setIsSidebarOpen(false); navigateToTab(t); }} isCollapsed={isSidebarCollapsed} />
              </>
            )}
          </nav>

          <div className={`space-y-3 ${isSidebarCollapsed ? 'p-2 lg:p-3' : 'p-4'}`}>
            {/* Cartão completo: mobile sempre; desktop só quando expandida */}
            <div className={`p-5 bg-slate-100 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl ${isSidebarCollapsed ? 'lg:hidden' : ''}`}>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-600/10 flex items-center justify-center text-[10px] font-black text-blue-500 border border-blue-500/20 shadow-lg shadow-blue-900/20">
                    {user?.name?.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-[11px] font-black text-slate-900 dark:text-white uppercase tracking-tight">{user?.name}</p>
                    <p className="text-[8px] text-slate-600 dark:text-slate-500 font-bold uppercase tracking-widest">{user?.role === 'admin' ? 'Administrador' : 'Operador'}</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsLogoutConfirmOpen(true)}
                  className="w-7 h-7 rounded-lg bg-red-500/10 text-red-500 border border-red-500/20 flex items-center justify-center hover:bg-red-500 hover:text-slate-900 dark:hover:text-white transition-all shadow-lg"
                  title="Sair do Sistema"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-[8px] font-black text-slate-600 dark:text-slate-500 uppercase tracking-widest">
                  <span>Ocupação G0</span>
                  <span>{stats.occupancyRate}%</span>
                </div>
                <div className="h-1.5 bg-slate-50 dark:bg-slate-950 rounded-full border border-slate-200 dark:border-slate-800 overflow-hidden relative [container-type:inline-size]">
                   <div className="h-full rounded-full overflow-hidden relative transition-all duration-1000" style={{ width: `${stats.occupancyRate}%` }}>
                      <div className="h-full w-[100cqw] absolute top-0 left-0 bg-gradient-to-r from-sky-400 via-amber-500 to-red-500" />
                   </div>
                </div>
              </div>
            </div>

            {/* Cartão compacto: só desktop, quando recolhida — avatar + botão de sair, empilhados */}
            <div className={`hidden flex-col items-center gap-2 ${isSidebarCollapsed ? 'lg:flex' : ''}`}>
              <div
                className="w-9 h-9 rounded-xl bg-blue-600/10 flex items-center justify-center text-[10px] font-black text-blue-500 border border-blue-500/20 shadow-lg shadow-blue-900/20"
                title={`${user?.name || ''} (${user?.role === 'admin' ? 'Administrador' : 'Operador'}) — Ocupação G0: ${stats.occupancyRate}%`}
              >
                {user?.name?.charAt(0).toUpperCase()}
              </div>
              <button
                onClick={() => setIsLogoutConfirmOpen(true)}
                className="w-8 h-8 rounded-lg bg-red-500/10 text-red-500 border border-red-500/20 flex items-center justify-center hover:bg-red-500 hover:text-slate-900 dark:hover:text-white transition-all shadow-lg"
                title="Sair do Sistema"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
        <header className="bg-slate-50/80 dark:bg-slate-950/80 backdrop-blur-xl border-b border-slate-300/50 dark:border-slate-900/50 h-16 px-4 md:px-10 flex justify-between items-center sticky top-0 z-40 shrink-0">
          <div className="flex items-center gap-3 md:gap-4">
            {!isPublicView && (
              <button 
                onClick={() => setIsSidebarOpen(true)}
                className="lg:hidden w-10 h-10 bg-slate-100 dark:bg-slate-900/80 border border-slate-300 dark:border-slate-800/50 rounded-2xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white transition-all active:scale-95 shadow-lg"
              >
                <Menu className="w-5 h-5" />
              </button>
            )}
            {isPublicView && <Logo size="sm" />}
            <h2 className="text-base md:text-xl font-black text-slate-900 dark:text-white tracking-tight uppercase italic line-clamp-1">
              {isPublicView ? 'Dashboard Público' : (
                <>
                  {activeTab === 'dashboard' && 'Painel de Controle'}
                  {activeTab === 'quicksearch' && 'Consulta Rápida'}
                  {activeTab === 'waiting' && 'Aguardando Vaga'}
                  
                  {activeTab === 'inventory' && 'Estoque Geral'}
                  {activeTab === 'map' && 'Mapa de vagas'}
                  {activeTab === 'analysis' && 'Análise de Recebimento'}
                  {activeTab === 'history' && 'Histórico'}
                  {activeTab === 'shipments' && 'Gestão de Carregamentos'}
                  {activeTab === 'rotative' && 'Estoque Rotativo'}
                  {activeTab === 'approvals' && 'Aprovações de Edição'}
                  {activeTab === 'users' && 'Admin'}
                </>
              )}
            </h2>
          </div>
          
          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            {!isPublicView && (
              <OnlineOperatorsWidget 
                operators={onlineOperators}
                currentUser={user}
              />
            )}

            <button
              onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
              className="flex items-center justify-center w-10 h-10 bg-slate-100 dark:bg-slate-900/50 hover:bg-slate-200 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-800/50 rounded-full text-slate-600 dark:text-slate-500 hover:text-slate-900 dark:text-white transition-all active:scale-95 shadow-sm group"
              title={theme === 'dark' ? 'Mudar para Tema Claro' : 'Mudar para Tema Escuro'}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 group-hover:rotate-90 transition-transform duration-500" /> : <Moon className="w-4 h-4 group-hover:-rotate-12 transition-transform duration-500" />}
            </button>

             {isPublicView && (
               <button 
                 onClick={() => window.location.href = window.location.origin + window.location.pathname}
                 className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-slate-900 dark:text-white rounded-xl font-bold text-[9px] uppercase tracking-widest transition-all shadow-lg shadow-blue-900/20"
               >
                 Acessar App
               </button>
             )}
             
            {!isPublicView && (
              <div className="relative">
                <button
                  onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                  className="flex items-center justify-center w-10 h-10 bg-slate-100 dark:bg-slate-900/50 hover:bg-slate-200 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-800/50 rounded-full text-slate-600 dark:text-slate-500 hover:text-slate-900 dark:text-white transition-all active:scale-95 shadow-sm relative"
                  title="Notificações"
                >
                  <Bell className="w-4 h-4" />
                  {totalAppNotifications > 0 && (
                    <span className="absolute top-0 right-0 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-white dark:border-slate-950 animate-pulse">
                      {totalAppNotifications > 9 ? '9+' : totalAppNotifications}
                    </span>
                  )}
                </button>

                <AnimatePresence>
                  {isNotificationsOpen && (
                    <>
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-40"
                        onClick={() => setIsNotificationsOpen(false)}
                      />
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute right-0 mt-2 w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl z-50 overflow-hidden"
                      >
                        <div className="p-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center">
                          <h3 className="font-bold text-slate-800 dark:text-white text-sm flex items-center gap-2">
                            <Bell className="w-4 h-4 text-blue-500" />
                            Notificações
                          </h3>
                          {totalAppNotifications > 0 && (
                            <span className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-xs font-bold px-2 py-0.5 rounded-full">
                              {totalAppNotifications}
                            </span>
                          )}
                        </div>
                        <div className="max-h-[48vh] overflow-y-auto relative z-50">
                          {appNotifications.length > 0 ? (
                            <div className="p-2 space-y-1">
                              {appNotifications.map((n) => (
                                <button
                                  key={n.id}
                                  onClick={() => {
                                    if ((n as any).action) {
                                      (n as any).action();
                                    } else {
                                      navigateToTab(n.tab);
                                    }
                                    setIsNotificationsOpen(false);
                                  }}
                                  className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-left"
                                >
                                  <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                                    <n.icon className="w-5 h-5" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{n.label}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{n.count} {n.count === 1 ? 'item pendente' : 'itens pendentes'}</p>
                                  </div>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="p-5 text-center text-slate-500 dark:text-slate-400 text-xs flex flex-col items-center">
                              <Bell className="w-7 h-7 text-slate-300 dark:text-slate-700 mb-1.5" />
                              <p>Nenhuma pendência no momento</p>
                            </div>
                          )}
                        </div>

                        {/* Browser Desktop Notifications Card */}
                        <div className="border-t border-slate-100 dark:border-slate-800 p-2.5 bg-slate-50/60 dark:bg-slate-900/80">
                          {browserPerm === 'granted' ? (
                            <div className="p-2.5 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 rounded-xl space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                                    <BellRing className="w-3.5 h-3.5" />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100 leading-none">Alertas no Navegador</p>
                                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5">
                                      {isBrowserNotifActive ? 'Ativo em 2º plano' : 'Pausado'}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    onClick={handleTestBrowserNotification}
                                    className="px-2 py-1 text-[10px] font-bold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors"
                                    title="Enviar notificação de teste"
                                  >
                                    Testar
                                  </button>
                                  <button
                                    onClick={() => handleToggleBrowserNotif(!isBrowserNotifActive)}
                                    className={`w-9 h-5 rounded-full transition-colors p-0.5 flex items-center ${isBrowserNotifActive ? 'bg-blue-600 justify-end' : 'bg-slate-300 dark:bg-slate-700 justify-start'}`}
                                    title={isBrowserNotifActive ? 'Desativar notificações' : 'Ativar notificações'}
                                  >
                                    <span className="w-4 h-4 rounded-full bg-white shadow-sm" />
                                  </button>
                                </div>
                              </div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                                Notifica carregamentos, aprovações, análises e movimentações mesmo fora do app.
                              </p>
                            </div>
                          ) : browserPerm === 'denied' ? (
                            <div className="p-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-xl flex items-start gap-2 text-amber-800 dark:text-amber-300">
                              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                              <div className="text-[11px] leading-tight">
                                <span className="font-bold block">Notificações bloqueadas</span>
                                Habilite permissões no navegador para receber avisos em segundo plano.
                              </div>
                            </div>
                          ) : (
                            <div className="p-2.5 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/40 dark:to-indigo-950/40 border border-blue-200 dark:border-blue-800/60 rounded-xl space-y-2">
                              <div className="flex items-start gap-2">
                                <div className="w-6 h-6 rounded-md bg-blue-600 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                                  <BellRing className="w-3.5 h-3.5 animate-pulse" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100 leading-none">Notificações no Navegador</p>
                                  <p className="text-[10px] text-slate-600 dark:text-slate-400 leading-tight mt-1">
                                    Receba avisos de carregamento, aprovações, análise e movimentações em outras abas.
                                  </p>
                                </div>
                              </div>
                              <button
                                onClick={handleRequestBrowserPermission}
                                className="w-full py-1.5 px-3 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white text-xs font-bold rounded-lg shadow-sm transition-all flex items-center justify-center gap-1.5"
                              >
                                <Bell className="w-3.5 h-3.5" />
                                Ativar no Navegador
                              </button>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-8 lg:p-14 scroll-smooth">
          {(activeTab === 'dashboard' || isPublicView) && (
            <div className="max-w-7xl mx-auto space-y-6 md:space-y-8 animate-in fade-in duration-700">
                {/* Dashboard Actions */}
                <div className="flex flex-wrap gap-3">
                    {!isPublicView && selectedPallets.length > 0 && (
                        <>
                        <button 
                            onClick={() => setIsConsolidateDrawerOpen(true)}
                            className="w-full md:w-auto px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-slate-900 dark:text-white rounded-xl font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 animate-in zoom-in duration-200"
                        >
                            <Layers className="w-3.5 h-3.5" /> Consolidar ({selectedPallets.length})
                        </button>
                        <button 
                            onClick={() => setIsShipmentModalOpen(true)}
                            className="w-full md:w-auto px-5 py-3 bg-purple-600 hover:bg-purple-500 text-slate-900 dark:text-white rounded-xl font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-purple-900/20 animate-in zoom-in duration-200"
                        >
                            <Truck className="w-3.5 h-3.5" /> Enviar para Carregamento ({selectedPallets.length})
                        </button>
                    </>
                    )}
                    {!isPublicView && (
                      <>
                        <button 
                            onClick={handleExportInventory}
                            className="px-4 py-2 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition-all border border-slate-200 dark:border-slate-800 hover:border-blue-500/30 group"
                        >
                            <Download className="w-3.5 h-3.5 text-blue-500 group-hover:scale-110 transition-transform" /> Exportar CSV
                        </button>
                        <button 
                            onClick={handleShareDashboard}
                            className="px-4 py-2 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition-all border border-slate-200 dark:border-slate-800 hover:border-purple-500/30 group"
                        >
                            <Share2 className="w-3.5 h-3.5 text-purple-500 group-hover:scale-110 transition-transform" /> Compartilhar Dashboard
                        </button>
                      </>
                    )}
                </div>

                {/* Occupancy Progress Bar Area */}
                <div className="grid grid-cols-1 gap-6">
                  {/* General Occupancy (A-D) */}
                  <div className="bg-slate-100 dark:bg-slate-900/40 p-6 rounded-[2rem] border border-slate-300 dark:border-slate-800/50 shadow-xl space-y-3 relative overflow-hidden">
                    <div className="flex justify-between items-end">
                      <div>
                        <h4 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest italic">Estoque Geral (A-D)</h4>
                        <p className="text-[9px] text-slate-600 dark:text-slate-500 font-bold uppercase tracking-widest">Capacidade Real Pallets</p>
                      </div>
                      <div className="text-right flex items-center gap-4">
                        {!isPublicView && (
                          <button 
                            onClick={handleResyncSlots}
                            className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 text-slate-600 dark:text-slate-500 hover:text-blue-500 rounded-lg border border-slate-200 dark:border-slate-800 transition-all group"
                            title="Sincronizar Vagas"
                          >
                            <RefreshCw className="w-3.5 h-3.5 group-active:rotate-180 transition-transform duration-500" />
                          </button>
                        )}
                        <span className="text-2xl font-black text-blue-500 italic">{stats.occupancyRate}%</span>
                      </div>
                    </div>
                    <div className="h-3 bg-slate-50 dark:bg-slate-950 rounded-full border border-slate-200 dark:border-slate-800 overflow-hidden relative [container-type:inline-size]">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(stats.occupancyRate, 100)}%` }}
                        transition={{ duration: 1.5, ease: "easeOut" }}
                        className="h-full rounded-full overflow-hidden relative"
                      >
                        <div className="h-full w-[100cqw] absolute top-0 left-0 bg-gradient-to-r from-sky-400 via-amber-500 to-red-500" />
                      </motion.div>
                      {stats.occupancyRate > 100 && (
                        <div className="absolute inset-0 bg-red-600/10 pointer-events-none animate-pulse" />
                      )}
                    </div>
                    <div className="flex justify-between text-[8px] font-black text-slate-600 uppercase tracking-widest">
                      <span>Livre</span>
                      <span className={stats.occupancyRate > 90 ? 'text-red-500' : 'text-slate-600 dark:text-slate-500'}>
                        {stats.occupiedSlots} / {stats.totalSlots} Vagas
                      </span>
                      <span>Ocupado</span>
                    </div>
                  </div>

                  </div>

                {/* Stats Section */}
                <StatsSection stats={stats} isPublicView={isPublicView} onNavigate={navigateToTab} />

                {/* Charts Area - Keeping some but making them more modern */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 md:gap-8">
                  {/* Rack Distribution Chart */}
                  <RackDistributionChart slots={slots} waitingPallets={stats.waitingPallets} />

                  {/* Product Distribution Card */}
                  <div className="space-y-6">
                    <ProductDistributionChart 
                      productDistribution={stats.productDistribution} 
                      occupiedSlots={stats.occupiedSlots} 
                    />
                    
                    {warehouseDiagnostic && (warehouseDiagnostic.noDefinitiveSlot > 0 || warehouseDiagnostic.slotConflicts > 0 || warehouseDiagnostic.orphanedSlots > 0 || warehouseDiagnostic.freeSlotsWithPallets > 0) && (
                      <div className="space-y-4">
                        {warehouseDiagnostic.noDefinitiveSlot > 0 && (
                          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-amber-600/10 border border-amber-500/30 p-4 rounded-3xl flex items-center gap-4">
                            <div className="w-10 h-10 bg-amber-600/20 text-amber-500 rounded-xl flex items-center justify-center shrink-0">
                              <AlertCircle className="w-6 h-6" />
                            </div>
                            <div className="flex-1">
                              <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest italic">Pendente de Alocação</p>
                              <p className="text-[11px] font-medium text-slate-700 dark:text-slate-300 leading-tight">
                                Existem {warehouseDiagnostic.noDefinitiveSlot} pallets cadastrados sem vaga definitiva.
                              </p>
                            </div>
                            <button onClick={() => setIsDiagnosticDetailsOpen(true)} className="text-[9px] font-black uppercase tracking-widest text-amber-500 hover:underline px-2">Ver detalhes</button>
                          </motion.div>
                        )}

                        {warehouseDiagnostic.slotConflicts > 0 && (
                          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-rose-600/10 border border-rose-500/30 p-4 rounded-3xl flex items-center gap-4">
                            <div className="w-10 h-10 bg-rose-600/20 text-rose-500 rounded-xl flex items-center justify-center shrink-0">
                              <AlertCircle className="w-6 h-6" />
                            </div>
                            <div className="flex-1">
                              <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest italic">Conflito de Vagas</p>
                              <p className="text-[11px] font-medium text-slate-700 dark:text-slate-300 leading-tight">
                                Existem {warehouseDiagnostic.slotConflicts} vagas com conflito, onde mais de um pallet está registrado na mesma posição. Esses casos exigem conferência manual.
                              </p>
                            </div>
                            <button onClick={() => setIsDiagnosticDetailsOpen(true)} className="text-[9px] font-black uppercase tracking-widest text-rose-500 hover:underline px-2">Ver detalhes</button>
                          </motion.div>
                        )}

                        {warehouseDiagnostic.orphanedSlots > 0 && (
                          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-indigo-600/10 border border-indigo-500/30 p-4 rounded-3xl flex items-center gap-4">
                            <div className="w-10 h-10 bg-indigo-600/20 text-indigo-500 rounded-xl flex items-center justify-center shrink-0">
                              <HelpCircle className="w-6 h-6" />
                            </div>
                            <div className="flex-1">
                              <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest italic">Vagas Órfãs</p>
                              <p className="text-[11px] font-medium text-slate-700 dark:text-slate-300 leading-tight">
                                Existem {warehouseDiagnostic.orphanedSlots} vagas marcadas como ocupadas no mapa, mas sem pallet correspondente no inventário.
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button onClick={() => setIsDiagnosticDetailsOpen(true)} className="text-[9px] font-black uppercase tracking-widest text-indigo-500 hover:underline px-2">Ver detalhes</button>
                              {!isPublicView && (
                                <button onClick={handleResyncSlots} className="bg-indigo-500/20 text-indigo-500 border border-indigo-500/30 px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest flex items-center gap-1.5 hover:bg-indigo-500/30 transition-all">
                                  <RefreshCw className="w-3 h-3" /> Reparar
                                </button>
                              )}
                            </div>
                          </motion.div>
                        )}

                        {warehouseDiagnostic.freeSlotsWithPallets > 0 && (
                          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-emerald-600/10 border border-emerald-500/30 p-4 rounded-3xl flex items-center gap-4">
                            <div className="w-10 h-10 bg-emerald-600/20 text-emerald-500 rounded-xl flex items-center justify-center shrink-0">
                              <CheckCircle2 className="w-6 h-6" />
                            </div>
                            <div className="flex-1">
                              <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest italic">Vagas Não Marcadas</p>
                              <p className="text-[11px] font-medium text-slate-700 dark:text-slate-300 leading-tight">
                                Foram encontradas {warehouseDiagnostic.freeSlotsWithPallets} vagas marcadas como livres no mapa, mas que possuem pallets registrados no inventário.
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button onClick={() => setIsDiagnosticDetailsOpen(true)} className="text-[9px] font-black uppercase tracking-widest text-emerald-500 hover:underline px-2">Ver detalhes</button>
                              {!isPublicView && (
                                <button onClick={handleResyncSlots} className="bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest flex items-center gap-1.5 hover:bg-emerald-500/30 transition-all">
                                  <RefreshCw className="w-3 h-3" /> Reparar
                                </button>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
            </div>
          )}

          {activeTab === 'map' && (
            <WarehouseMap 
              slots={slots} 
              onSlotClick={setSelectedMappingSlot} 
            />
          )}



          {activeTab === 'waiting' && (
            <WaitingSlotsView 
              items={waitingRows}
              onAssignSlot={(row, idx) => {
                setEditPalletMode('assign');
                setEditPalletContext({ row, inspection: row.inspections![idx], idx });
              }}
              selectedPallets={selectedPallets}
              onToggleSelection={togglePalletSelection}
              onSendToShipment={() => setIsBulkConfirmOpen(true)}
            />
          )}

          {activeTab === 'analysis' && (
            <AnalysisPage 
              pendingItems={pendingRows}
              availableSlots={slots.filter(s => s.status === SlotContent.EMPTY)}
              allSlots={slots}
              onConfirm={handleConfirmAnalysis}
              onReject={handleRejectAnalysis}
              onImport={handleImportProcess}
            />
          )}

          {activeTab === 'shipments' && (
            <ShipmentPage 
              shipments={shipments}
              inventory={data}
              shipmentCounts={shipmentCounts}
              onOpenDetail={handleOpenShipmentDetail}
              onDelete={handleDeleteShipment}
            />
          )}

          {activeTab === 'history' && (
            <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-500">
                <div className="relative w-full">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-700 w-4 h-4" />
                    <input 
                        type="text" 
                        value={historySearch}
                        onChange={(e) => setHistorySearch(e.target.value)}
                        placeholder="Pesquisar no histórico (OP, Produto, Lote, ID)..." 
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-11 py-3 text-slate-900 dark:text-white font-semibold text-sm focus:border-blue-600 outline-none transition-all placeholder:text-slate-700"
                    />
                    {isSearchingHistory && (
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-slate-400 border-t-blue-600 rounded-full animate-spin" />
                    )}
                </div>
                {historySearch && !isSearchingHistory && (
                  <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest -mt-3">
                    Pesquisando em todo o histórico, não só nos itens carregados
                  </p>
                )}

                <div className="space-y-3">
                    {history.length === 0 ? (
                        <div className="py-32 text-center border-2 border-dashed border-slate-300 dark:border-slate-900 rounded-[2.5rem]">
                            <History className="w-12 h-12 text-slate-800 mx-auto mb-4" />
                            <p className="text-slate-700 font-bold uppercase text-[10px] tracking-[0.3em]">
                                {historySearch ? 'Nenhum registro encontrado para esta pesquisa' : 'Sem movimentações registradas'}
                            </p>
                        </div>
                    ) : (
                        history.map(entry => (
                          <HistoryItem key={entry.id} entry={entry} onRecover={handleRecoverPallet} inventory={data} />
                        )))}
                </div>

                {hasMoreHistory && (
                  <div className="flex justify-center pt-2">
                    <button
                      onClick={loadMoreHistoryEntries}
                      disabled={isLoadingMoreHistory}
                      className="px-6 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white font-black text-[10px] uppercase tracking-widest transition-all disabled:opacity-50 hover:border-blue-600"
                    >
                      {isLoadingMoreHistory ? 'Carregando...' : 'Carregar mais'}
                    </button>
                  </div>
                )}
            </div>
          )}

          {activeTab === 'rotative' && (
            <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
              <RotativeStockManager 
                slots={slots}
                onUpdateSlot={async (slot) => {
                  try {
                    await supabaseService.updateSlot(slot);
                    setSlots(prev => prev.map(s => s.id === slot.id ? slot : s));
                  } catch (error) {
                    showNotification('Erro ao atualizar vaga', 'error');
                  }
                }}
                onShowNotification={showNotification}
                onAddHistory={addToHistory}
              />
            </div>
          )}

          {activeTab === 'users' && user?.role === 'admin' && (
            <div className="max-w-7xl mx-auto space-y-6">
              <div className="flex flex-wrap gap-3">
                <button
                    onClick={() => setIsBackupModalOpen(true)}
                    className="px-4 py-2 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition-all border border-slate-200 dark:border-slate-800 hover:border-blue-500/30 group"
                >
                    <DatabaseBackup className="w-3.5 h-3.5 text-blue-500 group-hover:scale-110 transition-transform" /> Backup Completo (JSON)
                </button>
                <button
                    onClick={() => setIsRestoreBackupModalOpen(true)}
                    className="px-4 py-2 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition-all border border-slate-200 dark:border-slate-800 hover:border-rose-500/30 group"
                >
                    <UploadCloud className="w-3.5 h-3.5 text-rose-500 group-hover:scale-110 transition-transform" /> Restaurar Backup
                </button>
              </div>
              <UserManager />
            </div>
          )}

          {activeTab === 'approvals' && user?.role === 'admin' && (
            <div className="max-w-7xl mx-auto">
              <ApprovalsPage currentUser={user} />
            </div>
          )}

          {activeTab === 'quicksearch' && (
            <div className="max-w-3xl mx-auto py-4">
              <QuickSearch 
                onShowDetail={(pallet) => handleShowDetail(pallet, pallet.inspections[0], 0)}
                onTransfer={(pallet) => {
                  setMovementInitialContext({
                    type: 'transfer',
                    id: pallet.loadingId || pallet.id,
                    pallet: pallet
                  });
                  
                }}
                onExit={(pallet) => {
                  setMovementInitialContext({
                    type: 'exit',
                    id: pallet.loadingId || pallet.id,
                    pallet: pallet
                  });
                  
                }}
                onAddToShipment={(pallet) => {
                  setSelectedPallets([`${pallet.id}::0`]);
                  setIsShipmentModalOpen(true);
                }}
              />
            </div>
          )}

          {activeTab === 'inventory' && (
            <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
                {/* Search and Filter Area */}
                <div className="flex flex-col md:flex-row gap-3 items-center flex-wrap">
                    <div className="relative flex-1 w-full min-w-[220px]">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-700 w-4 h-4" />
                        <input
                            type="text"
                            value={inventorySearch}
                            onChange={(e) => setInventorySearch(e.target.value)}
                            placeholder="Digite a VAGA, OP, Produto, Lote ou SEM SELO..."
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-11 py-3 text-slate-900 dark:text-white font-semibold text-sm focus:border-blue-600 outline-none transition-all placeholder:text-slate-700"
                        />
                    </div>
                    {!isPublicView && (
                      <button 
                        onClick={() => setIsManualAddModalOpen(true)}
                        className="w-full md:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20 transition-all active:scale-95 whitespace-nowrap"
                      >
                        <Plus className="w-4 h-4" /> Adicionar Manualmente
                      </button>
                    )}

                    
                    {/* Type Filter Dropdown */}
                    <div className="relative w-full md:w-64">
                      <button
                        onClick={() => setIsInventoryFilterOpen(!isInventoryFilterOpen)}
                        className={`w-full flex items-center justify-between px-5 py-3 bg-white dark:bg-slate-900 border ${isInventoryFilterOpen ? 'border-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.2)]' : 'border-slate-200 dark:border-slate-800'} rounded-xl transition-all group`}
                      >
                        <div className="flex items-center gap-3">
                          <Filter className={`w-4 h-4 ${inventoryTypeFilter !== 'ALL' ? 'text-blue-500' : 'text-slate-600 dark:text-slate-500'}`} />
                          <span className={`text-[10px] font-black uppercase tracking-widest ${inventoryTypeFilter !== 'ALL' ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-500'}`}>
                            {inventoryTypeFilter === 'ALL' ? 'Todos os Tipos' : 
                             inventoryTypeFilter === 'SEM_SELO' ? 'SEM SELO' : 
                             inventoryTypeFilter === 'DATADOS' ? 'FRASCOS DATADOS' :
                             inventoryTypeFilter === 'CONTAINER' ? 'Container (SJ/LP/CP)' : 
                             translateSlotContent(inventoryTypeFilter as SlotContent)}
                          </span>
                        </div>
                        <ChevronDown className={`w-4 h-4 text-slate-600 dark:text-slate-500 transition-transform duration-300 ${isInventoryFilterOpen ? 'rotate-180' : ''}`} />
                      </button>

                      {isInventoryFilterOpen && (
                        <>
                          <div className="fixed inset-0 z-[60]" onClick={() => setIsInventoryFilterOpen(false)} />
                          <div className="absolute top-full left-0 right-0 mt-2 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl z-[70] animate-in fade-in zoom-in-95 duration-200">
                            <div className="grid grid-cols-1 gap-1 max-h-64 overflow-y-auto pr-1">
                              {[
                                { value: 'ALL', label: 'Todos os Tipos' },
                                { value: 'SEM_SELO', label: 'SEM SELO' },
                                { value: 'DATADOS', label: 'FRASCOS DATADOS' },
                                { value: SlotContent.BOTTLES, label: 'Frasco' },
                                { value: SlotContent.SUPPLIES, label: 'Insumo' },
                                { value: SlotContent.FINISHED_PRODUCT, label: 'Produto Acabado' },
                                { value: 'CONTAINER', label: 'Todos os Containers' },
                                { value: SlotContent.CONTAINER_SJ, label: '• Container Sujo', isSub: true },
                                { value: SlotContent.CONTAINER_LP, label: '• Container Limpo', isSub: true },
                                { value: SlotContent.CONTAINER_CP, label: '• Container com Produto', isSub: true },
                                { value: SlotContent.REWORK, label: 'Retrabalho' },
                                { value: SlotContent.REPROCESS, label: 'Reprocesso' },
                                { value: SlotContent.USE_CONSUMPTION, label: 'Uso e Consumo' },
                                { value: SlotContent.RETURN, label: 'Retorno' },
                                { value: SlotContent.MISCELLANEOUS, label: 'Diversos' },
                                { value: SlotContent.DISCARD, label: 'Descarte' },
                                { value: SlotContent.OTHER, label: 'Outro' }
                              ].map((type) => (
                                <button
                                  key={type.value}
                                  onClick={() => {
                                    setInventoryTypeFilter(type.value as any);
                                    setIsInventoryFilterOpen(false);
                                  }}
                                  className={`flex items-center justify-between px-4 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                                    (type as any).isSub ? 'ml-4 bg-slate-50/30 dark:bg-slate-950/30' : ''
                                  } ${
                                    inventoryTypeFilter === type.value 
                                      ? 'bg-blue-600 text-slate-900 dark:text-white' 
                                      : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800 hover:text-slate-900 dark:text-white'
                                  }`}
                                >
                                  {type.label}
                                  {inventoryTypeFilter === type.value && <CheckCircle2 className="w-3 h-3" />}
                                </button>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                </div>

                {/* Selection Action Bar - separate row so it never competes with the search field for space */}
                {selectedPallets.length > 0 && (
                    <div className="flex flex-wrap gap-3 items-center bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 animate-in fade-in slide-in-from-top-2 duration-200">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mr-1">
                            {selectedPallets.length} {selectedPallets.length === 1 ? 'selecionado' : 'selecionados'}
                        </span>
                        <button
                            onClick={() => setIsConsolidateDrawerOpen(true)}
                            className="flex-1 md:flex-none px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-slate-900 dark:text-white rounded-xl font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20"
                        >
                            <Layers className="w-3.5 h-3.5" /> Consolidar ({selectedPallets.length})
                        </button>
                        <button
                            onClick={() => setIsShipmentModalOpen(true)}
                            className="flex-1 md:flex-none px-5 py-3 bg-fuchsia-600 hover:bg-fuchsia-500 text-slate-900 dark:text-white rounded-xl font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-fuchsia-900/20"
                        >
                            <Truck className="w-3.5 h-3.5" /> Carregamento ({selectedPallets.length})
                        </button>
                        <button
                            onClick={() => setIsBulkConfirmOpen(true)}
                            className="flex-1 md:flex-none px-5 py-3 bg-blue-600 hover:bg-blue-500 text-slate-900 dark:text-white rounded-xl font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20"
                        >
                            <Send className="w-3.5 h-3.5" /> Enviar ({selectedPallets.length})
                        </button>
                    </div>
                )}

                {filteredInventory.length === 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
                        <div className="col-span-full py-20 text-center border-2 border-dashed border-slate-300 dark:border-slate-900 rounded-[32px]">
                            <p className="text-slate-700 font-black uppercase text-[10px] tracking-[0.3em]">Nenhum item encontrado no estoque</p>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredInventory.map(({ row, inspection, idx }) => (
                            <InventoryCard
                                key={`${row.id}::${idx}`}
                                item={row}
                                insp={inspection}
                                idx={idx}
                                isSelected={selectedPallets.includes(`${row.id}::${idx}`)}
                                onToggleSelection={togglePalletSelection}
                                onShowDetail={handleShowDetail}
                                onEdit={handleEditPallet}
                                onDelete={handleDeletePallet}
                                userRole={user?.role}
                            />
                        ))}
                    </div>
                )}

                {activeTab === 'inventory' && hasMoreInventory && (
                  <div className="flex justify-center pt-8 pb-12">
                    <button
                      onClick={loadMoreInventory}
                      disabled={isLoadingMore}
                      className="px-8 py-4 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-[20px] font-black uppercase text-xs tracking-widest hover:bg-slate-100 dark:bg-slate-800 transition-all disabled:opacity-50 flex items-center gap-3 border border-slate-200 dark:border-slate-800 shadow-xl"
                    >
                      {isLoadingMore ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span>Carregando...</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-5 h-5" />
                          <span>Carregar Mais Pallets</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
            </div>
          )}
        </div>
      </main>

      {/* Modals & Dialogs */}

      {isDiagnosticDetailsOpen && warehouseDiagnostic && (
        <div className="fixed inset-0 bg-slate-50/80 dark:bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]"
          >
            <div className="p-8 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-100 dark:bg-slate-900/50">
              <div>
                <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase italic tracking-tight">Diagnóstico do Armazém</h3>
                <p className="text-xs text-slate-600 dark:text-slate-500 font-bold uppercase tracking-widest">Conferência de integridade de dados</p>
              </div>
              <button onClick={() => setIsDiagnosticDetailsOpen(false)} className="p-2 hover:bg-slate-100 dark:bg-slate-800 rounded-xl transition-colors">
                <X className="w-6 h-6 text-slate-500 dark:text-slate-400" />
              </button>
            </div>
            
            <div className="p-8 overflow-y-auto space-y-8">
              {warehouseDiagnostic.details.noDefinitiveSlotItems.length > 0 && (
                <section className="space-y-3">
                  <h4 className="text-[10px] font-black text-amber-500 uppercase tracking-widest flex items-center gap-2 italic">
                    <AlertCircle className="w-3 h-3" /> Pallets sem vaga definitiva
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {warehouseDiagnostic.details.noDefinitiveSlotItems.map((item, i) => (
                      <div key={i} className="bg-slate-50/50 dark:bg-slate-950/50 p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-[10px] font-bold text-slate-700 dark:text-slate-300">
                        {item}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {warehouseDiagnostic.details.conflictSlots.length > 0 && (
                <section className="space-y-3">
                  <h4 className="text-[10px] font-black text-rose-500 uppercase tracking-widest flex items-center gap-2 italic">
                    <AlertCircle className="w-3 h-3" /> Vagas em conflito (Múltiplos pallets)
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {warehouseDiagnostic.details.conflictSlots.map((slotId, i) => (
                      <div key={i} className="bg-rose-500/10 p-3 rounded-xl border border-rose-500/20 text-[10px] font-black text-rose-500 text-center uppercase tracking-widest">
                        {slotId}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {warehouseDiagnostic.details.orphanedSlotIds.length > 0 && (
                <section className="space-y-3">
                  <h4 className="text-[10px] font-black text-indigo-500 uppercase tracking-widest flex items-center gap-2 italic">
                    <HelpCircle className="w-3 h-3" /> Vagas Órfãs (Fixação Segura)
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {warehouseDiagnostic.details.orphanedSlotIds.map((slotId, i) => (
                      <div key={i} className="bg-indigo-500/10 p-3 rounded-xl border border-indigo-500/20 text-[10px] font-black text-indigo-500 text-center uppercase tracking-widest">
                        {slotId}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {warehouseDiagnostic.details.freeSlotWithPalletIds.length > 0 && (
                <section className="space-y-3">
                  <h4 className="text-[10px] font-black text-emerald-500 uppercase tracking-widest flex items-center gap-2 italic">
                    <CheckCircle2 className="w-3 h-3" /> Vagas Livres com Pallets (Fixação Segura)
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {warehouseDiagnostic.details.freeSlotWithPalletIds.map((slotId, i) => (
                      <div key={i} className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 text-[10px] font-black text-emerald-500 text-center uppercase tracking-widest">
                        {slotId}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {(!warehouseDiagnostic || (warehouseDiagnostic.noDefinitiveSlot === 0 && warehouseDiagnostic.slotConflicts === 0 && warehouseDiagnostic.orphanedSlots === 0 && warehouseDiagnostic.freeSlotsWithPallets === 0)) && (
                <div className="py-12 text-center space-y-4">
                  <div className="w-16 h-16 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white tracking-tight uppercase tracking-widest">Nenhuma divergência encontrada</p>
                    <p className="text-[10px] text-slate-600 dark:text-slate-500 font-bold uppercase tracking-widest mt-1">O armazém está em conformidade total.</p>
                  </div>
                </div>
              )}
            </div>

            <div className="p-8 border-t border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/50 flex justify-end gap-4">
              <button 
                onClick={() => setIsDiagnosticDetailsOpen(false)}
                className="px-6 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:bg-slate-800 transition-all font-black"
              >
                Fechar
              </button>
              {!isPublicView && (warehouseDiagnostic.orphanedSlots > 0 || warehouseDiagnostic.freeSlotsWithPallets > 0) && (
                <button 
                  onClick={handleResyncSlots}
                  className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-slate-900 dark:text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-indigo-600/20 flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" /> Reparar Vagas
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}
      
      {isBulkConfirmOpen && (
        <InventoryBulkConfirmModal 
          isOpen={isBulkConfirmOpen}
          onClose={() => setIsBulkConfirmOpen(false)}
          onConfirm={handleBulkSend}
          onRemovePallet={(key) => setSelectedPallets(prev => prev.filter(k => k !== key))}
          selectedPallets={selectedPalletsData}
        />
      )}

      {deleteContext && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-50/80 dark:bg-slate-950/80 backdrop-blur-md p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-3xl text-center space-y-6 animate-in zoom-in duration-200">
            <div className="w-14 h-14 md:w-16 md:h-16 bg-red-600/10 text-red-500 rounded-full flex items-center justify-center mx-auto border border-red-500/20"><AlertCircle className="w-8 h-8" /></div>
            <h3 className="text-slate-900 dark:text-white font-black uppercase text-lg md:text-xl italic tracking-tight">Confirmar Exclusão</h3>
            <p className="text-slate-600 dark:text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-widest leading-relaxed">{deleteContext.type === 'row' ? 'Deseja remover este carregamento da fila?' : 'Deseja remover este pallet do inventário?'}</p>
            <div className="flex gap-4 pt-4"><button onClick={() => setDeleteContext(null)} className="flex-1 py-3 md:py-3.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-black text-[9px] md:text-[10px] uppercase rounded-2xl transition-all">Cancelar</button><button onClick={confirmDelete} className="flex-1 py-3 md:py-3.5 bg-red-600 text-slate-900 dark:text-white font-black text-[9px] md:text-[10px] uppercase rounded-2xl shadow-lg transition-all active:scale-95">Remover</button></div>
          </div>
        </div>
      )}

      {matrixConfirmContext && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-50/80 dark:bg-slate-950/80 backdrop-blur-md p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-3xl text-center space-y-6 animate-in zoom-in duration-200">
            <div className="w-14 h-14 md:w-16 md:h-16 bg-blue-600/10 text-blue-500 rounded-full flex items-center justify-center mx-auto border border-red-500/20 shadow-xl shadow-blue-900/20"><Truck className="w-8 h-8" /></div>
            <h3 className="text-slate-900 dark:text-white font-black uppercase text-lg md:text-xl italic tracking-tight">Confirmar Envio</h3>
            <p className="text-slate-600 dark:text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-widest leading-relaxed px-4">Tem certeza que deseja enviar este pallet para processamento na Matriz?</p>
            <div className="flex gap-4 pt-4">
              <button onClick={() => setMatrixConfirmContext(null)} className="flex-1 py-3 md:py-3.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-black text-[9px] md:text-[10px] uppercase rounded-2xl transition-all">Não</button>
              <button onClick={confirmMatrixSend} className="flex-1 py-3 md:py-3.5 bg-blue-600 text-slate-900 dark:text-white font-black text-[9px] md:text-[10px] uppercase rounded-2xl shadow-lg shadow-blue-900/40 transition-all active:scale-95">Sim, Enviar</button>
            </div>
          </div>
        </div>
      )}

      {isLogoutConfirmOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-50/80 dark:bg-slate-950/80 backdrop-blur-xl p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[32px] p-8 max-w-sm w-full shadow-3xl text-center space-y-6 animate-in zoom-in duration-300">
            <div className="w-16 h-16 bg-red-600/10 text-red-500 rounded-2xl flex items-center justify-center mx-auto border border-red-500/20 shadow-xl shadow-red-900/20">
              <LogOut className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-slate-900 dark:text-white font-black uppercase text-xl italic tracking-tight mb-2">Encerrar Sessão</h3>
              <p className="text-slate-600 dark:text-slate-500 text-xs font-bold uppercase tracking-widest leading-relaxed px-4">Tem certeza que deseja sair do sistema Stoque+?</p>
            </div>
            <div className="flex gap-4 pt-4">
              <button 
                onClick={() => setIsLogoutConfirmOpen(false)} 
                className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-black text-[10px] uppercase tracking-widest rounded-2xl transition-all hover:bg-slate-700"
              >
                Cancelar
              </button>
              <button 
                onClick={handleLogout} 
                className="flex-1 py-4 bg-red-600 text-slate-900 dark:text-white font-black text-[10px] uppercase tracking-widest rounded-2xl shadow-lg shadow-red-900/40 transition-all hover:bg-red-500 active:scale-95"
              >
                Sair
              </button>
            </div>
          </div>
        </div>
      )}

      {detailContext && <InventoryDetailModal isOpen={!!detailContext} onClose={() => setDetailContext(null)} row={detailContext.row} inspection={detailContext.inspection} palletIdx={detailContext.idx} onUnconsolidate={handleUnconsolidate} isUnconsolidating={isUnconsolidating} />}
      
      {editPalletContext && (
        <EditPalletModal 
          isOpen={!!editPalletContext}
          onClose={() => setEditPalletContext(null)}
          pallet={editPalletContext}
          onSave={handleUpdatePallet}
          history={history}
          availableSlots={slots.filter(s => s.status === SlotContent.EMPTY)}
          allSlots={slots}
          mode={editPalletMode}
          userRole={user?.role}
        />
      )}

      <ShipmentModal 
        isOpen={isShipmentModalOpen}
        onClose={() => setIsShipmentModalOpen(false)}
        openShipments={shipments.filter(s => s.status === ShipmentStatus.OPEN)}
        onCreateNew={handleCreateShipment}
        onAddToExisting={handleAddToShipment}
        selectedCount={selectedPallets.length}
      />

      
      <ConsolidateDrawer 
        isOpen={isConsolidateDrawerOpen}
        onClose={() => setIsConsolidateDrawerOpen(false)}
        selectedPalletsData={selectedPalletsData}
        user={user}
        onSuccess={() => {
           setIsConsolidateDrawerOpen(false);
           setSelectedPallets([]);
           showNotification('Pallets consolidados com sucesso!');
           refreshCombinedData();
        }}
      />

      <ShipmentDetailModal 
        isOpen={!!shipmentDetailContext}
        onClose={() => {
          setShipmentDetailContext(null);
          setShipmentDetailPallets([]);
        }}
        shipment={shipmentDetailContext}
        linkedPallets={shipmentDetailPallets}
        onFinalize={handleFinalizeShipment}
        onRemovePallet={async (palletId) => {
          await handleRemoveFromShipment(palletId);
          if (shipmentDetailContext) {
            fetchShipmentDetailPallets(shipmentDetailContext.id);
          }
        }}
        onMoveToWaiting={async (palletId) => {
          await handleMoveToWaitingSlot(palletId);
          if (shipmentDetailContext) {
            fetchShipmentDetailPallets(shipmentDetailContext.id);
          }
        }}
        onAddPallet={async (pallet) => {
          if (shipmentDetailContext) {
            await handleAddToShipmentSingle(pallet, shipmentDetailContext.id);
          }
        }}
        onAddUncatalogedPallet={async (palletData) => {
          if (shipmentDetailContext) {
            await handleAddUncatalogedPalletToShipment(palletData, shipmentDetailContext.id);
          }
        }}
        onUpdateObs={handleUpdateShipmentObs}
        availableSlots={slots.filter(s => s.status === SlotContent.EMPTY)}
        inventoryData={data}
        historyData={history}
        onDelete={handleDeleteShipment}
      />
      
                  <ManualPalletModal
        isOpen={isManualAddModalOpen}
        onClose={() => {
          setIsManualAddModalOpen(false);
          setMovementInitialContext(null);
        }}
        availableSlots={slots.filter(s => s.status === SlotContent.EMPTY)}
        onSave={handleManualAdd}
        inventoryData={data}
        historyData={history}
      />
      <MovementModal
        isOpen={isMovementModalOpen}
        onClose={() => {
          setIsMovementModalOpen(false);
          setMovementInitialContext(null);
        }}
        onTransfer={handleMovementTransfer}
        onExit={handleMovementExit}
        availableSlots={slots.filter(s => s.status === SlotContent.EMPTY)}
        inventoryData={data}
        initialType={movementInitialContext?.type as any}
        initialId={movementInitialContext?.id}
        initialPallet={movementInitialContext?.pallet}
      />
      <RecoveryModal
        isOpen={!!recoveryContext}
        onClose={() => setRecoveryContext(null)}
        onConfirm={confirmRecovery}
        isLoading={isRecovering}
      />
      {user?.role === 'admin' && (
        <BackupReminderModal
          isOpen={isBackupModalOpen}
          onClose={() => setIsBackupModalOpen(false)}
          onDownload={handleDownloadFullBackup}
          isLoading={isBackupDownloading}
        />
      )}
      {user?.role === 'admin' && (
        <RestoreBackupModal
          isOpen={isRestoreBackupModalOpen}
          onClose={() => setIsRestoreBackupModalOpen(false)}
          onRestore={handleRestoreBackup}
        />
      )}
    </div>
  );
};

export default App;
