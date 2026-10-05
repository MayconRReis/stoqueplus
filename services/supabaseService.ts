import { createClient } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured, disableSupabase, isFetchOrNetworkError, isRetryableError } from '../lib/supabase';
import { SheetRow, WarehouseSlot, HistoryEntry, StockStatus, SlotContent, HistoryType, Shipment, ShipmentType, ShipmentStatus, RotativeStockItem, DashboardStats, User, WarehouseDiagnostic, SHAREABLE_SLOT_TYPES, parseSlotContent, translateSlotContent, AutocompleteItem } from '../types';
import { formatOP } from '../lib/formatters';

const localStorageHelper = {
  get: (key: string) => {
    try {
      const data = localStorage.getItem(`stoque_plus_${key}`);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },
  save: (key: string, data: any) => {
    try {
      localStorage.setItem(`stoque_plus_${key}`, JSON.stringify(data));
    } catch (e) {
      console.warn('localStorage save failed:', e);
    }
  },
  add: (key: string, item: any) => {
    const data = localStorageHelper.get(key);
    localStorageHelper.save(key, [item, ...data]);
  },
  update: (key: string, item: any, idField: string = 'id') => {
    const data = localStorageHelper.get(key);
    const index = data.findIndex((i: any) => i[idField] === item[idField]);
    if (index !== -1) {
      data[index] = item;
      localStorageHelper.save(key, data);
    } else {
      localStorageHelper.add(key, item);
    }
  }
};

export const clientSessionId = typeof window !== 'undefined'
  ? ((window as any).__stoqueSessionId || ((window as any).__stoqueSessionId = Math.random().toString(36).substring(2, 11)))
  : 'server-' + Math.random().toString(36).substring(2, 7);

let syncChannel: any = null;
let syncBroadcastCallbacks: ((event: string, payload: any) => void)[] = [];
let syncPresenceCallbacks: ((users: any[]) => void)[] = [];
let currentPresenceUser: any = null;

/**
 * SQL for Supabase Setup (Run this in Supabase SQL Editor):
 * 
 * -- 1. Create Tables
 * CREATE TABLE inventory (
 *   id TEXT PRIMARY KEY,
 *   loading_id TEXT NOT NULL,
 *   origin_op TEXT NOT NULL,
 *   description TEXT,
 *   lot TEXT,
 *   pallets INTEGER DEFAULT 0,
 *   date TEXT,
 *   status TEXT DEFAULT 'PENDING',
 *   inspections JSONB DEFAULT '[]'::jsonb,
 *   is_group BOOLEAN DEFAULT false,
 *   parent_group_id TEXT REFERENCES inventory(id) ON DELETE SET NULL,
 *   created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
 * );
 * 
 * -- Migration: Consolidate Pallets
 * -- ALTER TABLE inventory ADD COLUMN is_group BOOLEAN DEFAULT false;
 * -- ALTER TABLE inventory ADD COLUMN parent_group_id TEXT REFERENCES inventory(id) ON DELETE SET NULL;
 * -- CREATE INDEX idx_inventory_parent_group_id ON inventory(parent_group_id);
 * 
 * CREATE TABLE warehouse_slots (
 *   id TEXT PRIMARY KEY,
 *   rack TEXT NOT NULL,
 *   level INTEGER NOT NULL,
 *   position INTEGER NOT NULL,
 *   status TEXT DEFAULT 'EMPTY',
 *   occupied_by TEXT,
 *   updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
 * );
 * 
 * CREATE TABLE history (
 *   id TEXT PRIMARY KEY,
 *   type TEXT NOT NULL,
 *   timestamp TEXT NOT NULL,
 *   loading_id TEXT NOT NULL,
 *   description TEXT,
 *   op TEXT,
 *   lot TEXT,
 *   pallet_number INTEGER,
 *   total_pallets INTEGER,
 *   slot TEXT,
 *   details TEXT,
 *   operator_name TEXT,
 *   pallet_type TEXT,
 *   created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
 * );
 * 
 * CREATE TABLE profiles (
 *   id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
 *   name TEXT,
 *   role TEXT DEFAULT 'operator',
 *   active BOOLEAN DEFAULT true,
 *   created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
 *   updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
 * );
 * 
 * -- Enable RLS for profiles
 * ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
 * 
 * -- Policies for profiles
 * CREATE POLICY "Profiles are viewable by authenticated users" 
 * ON public.profiles FOR SELECT TO authenticated USING (true);
 * 
 * CREATE POLICY "Only admins can update profiles" 
 * ON public.profiles FOR UPDATE TO authenticated 
 * USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
 * WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
 * 
 * CREATE POLICY "Only admins can insert profiles" 
 * ON public.profiles FOR INSERT TO authenticated 
 * WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
 * 
 * CREATE TABLE shipments (
 *   id TEXT PRIMARY KEY,
 *   type TEXT NOT NULL,
 *   status TEXT DEFAULT 'OPEN',
 *   created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
 *   scheduled_date TEXT,
 *   operator_name TEXT,
 *   pallet_type TEXT,
 *   closed_at TIMESTAMP WITH TIME ZONE
 * );
 * 
 * CREATE TABLE rotative_stock (
 *   id TEXT PRIMARY KEY,
 *   product_name TEXT NOT NULL,
 *   quantity INTEGER NOT NULL DEFAULT 0,
 *   slot_id TEXT NOT NULL REFERENCES warehouse_slots(id),
 *   type TEXT,
 *   updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
 * );
 * 
 * ALTER TABLE inventory ADD COLUMN shipment_id TEXT REFERENCES shipments(id);
 * 
 * -- 2. Disable RLS (or add policies)
 * ALTER TABLE inventory DISABLE ROW LEVEL SECURITY;
 * ALTER TABLE warehouse_slots DISABLE ROW LEVEL SECURITY;
 * ALTER TABLE history DISABLE ROW LEVEL SECURITY;
 * ALTER TABLE shipments DISABLE ROW LEVEL SECURITY;
 * ALTER TABLE rotative_stock DISABLE ROW LEVEL SECURITY;
 */

export type InventoryFilter = 'ROOT_ONLY' | 'CHILDREN_ONLY' | 'ALL';

const applyInventoryFilter = (query: any, filterType: InventoryFilter = 'ROOT_ONLY') => {
  if (filterType === 'ROOT_ONLY') return query.is('parent_group_id', null);
  if (filterType === 'CHILDREN_ONLY') return query.not('parent_group_id', 'is', null);
  return query;
};

const mapInventoryRow = (item: any): SheetRow => ({
  id: item.id,
  loadingId: item.loading_id,
  originOP: item.origin_op,
  description: item.description,
  lot: item.lot,
  pallets: item.pallets,
  date: item.date,
  status: item.status as StockStatus,
  inspections: item.inspections || [],
  operatorName: item.operator_name,
  is_group: item.is_group,
  parent_group_id: item.parent_group_id
});

export const isDedicatedFinishedProductSlot = (slotId: string): boolean => {
  if (!slotId) return false;
  const parts = slotId.split('.');
  if (parts.length !== 3) return false;
  const rack = parts[0].toUpperCase();
  const level = parseInt(parts[1], 10);
  const position = parseInt(parts[2], 10);

  if (level !== 1) return false;
  if (rack === 'B' && position >= 5 && position <= 16) return true;
  if (rack === 'C' && position >= 3 && position <= 14) return true;
  return false;
};

export const supabaseService = {
  async consolidatePallets(childIds: string[], parentId: string, historyId: string, userId: string | null, userName: string): Promise<any> {
    if (!isSupabaseConfigured) {
      // Mock implementation for local storage
      const inventory = localStorageHelper.get('inventory');
      const children = inventory.filter((item: any) => childIds.includes(item.id));
      if (children.length < 2) throw new Error('A consolidação requer pelo menos 2 pallets.');
      
      const firstChild = children[0];
      const loadingId = 'PC' + Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
      
      let totalPallets = 0;
      let totalBottles = 0;
      
      children.forEach((child: any) => {
        child.parent_group_id = parentId;
        totalPallets += child.pallets || 0;
        totalBottles += (child.inspections?.[0]?.bottles) || 0;
      });
      
      const newParent = {
        ...firstChild,
        id: parentId,
        loadingId: loadingId,
        loading_id: loadingId,
        pallets: totalPallets,
        is_group: true,
        parent_group_id: null,
        inspections: [
          {
            ...firstChild.inspections[0],
            bottles: totalBottles
          }
        ]
      };
      
      inventory.push(newParent);
      localStorageHelper.save('inventory', inventory);

      // Mesma correção do fluxo online: libera as vagas dos filhos que não são o primeiro (a do
      // primeiro fica com o grupo consolidado); sem isso as vagas ficavam presas como ocupadas.
      const placeholderSlots = [null, undefined, '', 'AGUARDANDO', 'N/A', 'SEM VAGA'];
      const firstChildSlots = new Set(
        (firstChild.inspections || []).map((i: any) => i.assignedSlot).filter((s: any) => !placeholderSlots.includes(s))
      );
      const slotsToFree = new Set<string>();
      children.slice(1).forEach((child: any) => {
        (child.inspections || []).forEach((insp: any) => {
          const slotId = insp.assignedSlot;
          if (!placeholderSlots.includes(slotId) && !firstChildSlots.has(slotId)) {
            slotsToFree.add(slotId);
          }
        });
      });
      for (const slotId of slotsToFree) {
        await this.freeSlot(slotId);
      }

      return { success: true, group_id: parentId, loading_id: loadingId, data: mapInventoryRow(newParent) };
    }
    
    const { data: children, error: fetchError } = await supabase.from('inventory').select('*').in('id', childIds);
    if (fetchError || !children || children.length < 2) throw new Error('Falha ao buscar pallets para consolidação.');

    const firstChild = children[0];
    const loadingId = 'PC' + Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    
    let totalPallets = 0;
    let totalBottles = 0;
    
    children.forEach((child: any) => {
      totalPallets += child.pallets || 0;
      totalBottles += (child.inspections?.[0]?.bottles) || 0;
    });

    const newParent = {
      id: parentId,
      loading_id: loadingId,
      origin_op: firstChild.origin_op,
      description: firstChild.description,
      lot: firstChild.lot,
      pallets: totalPallets,
      status: 'INSPECTED',
      is_group: true,
      parent_group_id: null,
      inspections: [
        {
          ...firstChild.inspections[0],
          bottles: totalBottles
        }
      ]
    };

    const { data: insertedParent, error: insertError } = await supabase.from('inventory').insert(newParent).select('*').single();
    if (insertError) throw insertError;

    const { error: updateError } = await supabase.from('inventory').update({ parent_group_id: parentId }).in('id', childIds);
    if (updateError) throw updateError;

    // O pallet consolidado herda a vaga do primeiro filho (é a que fica com o grupo). As vagas dos
    // demais filhos precisam ser liberadas aqui — sem isso, elas ficam marcadas como ocupadas para
    // sempre, mesmo que o pallet que as ocupava não exista mais como item independente.
    const placeholderSlots = [null, undefined, '', 'AGUARDANDO', 'N/A', 'SEM VAGA'];
    const firstChildSlots = new Set(
      (firstChild.inspections || []).map((i: any) => i.assignedSlot).filter((s: any) => !placeholderSlots.includes(s))
    );
    const slotsToFree = new Set<string>();
    children.slice(1).forEach((child: any) => {
      (child.inspections || []).forEach((insp: any) => {
        const slotId = insp.assignedSlot;
        if (!placeholderSlots.includes(slotId) && !firstChildSlots.has(slotId)) {
          slotsToFree.add(slotId);
        }
      });
    });
    for (const slotId of slotsToFree) {
      await this.freeSlot(slotId);
    }

    const { error: historyError } = await supabase.from('history').insert({
      id: historyId,
      type: 'transfer',
      loading_id: loadingId,
      origin_op: firstChild.origin_op,
      description: firstChild.description,
      lot: firstChild.lot,
      pallets: totalPallets,
      details: `Pallets consolidados em ${loadingId}`,
      user_id: userId,
      user_name: userName
    });

    return {
      success: true,
      group_id: parentId,
      loading_id: loadingId,
      data: mapInventoryRow(insertedParent)
    };
  },

  async unconsolidatePallets(groupId: string, historyId: string, userId: string | null, userName: string): Promise<any> {
    if (!isSupabaseConfigured) {
      let inventory = localStorageHelper.get('inventory');
      const groupIndex = inventory.findIndex((item: any) => item.id === groupId);
      if (groupIndex === -1) throw new Error('Grupo não encontrado.');

      const restoredChildren = inventory.filter((item: any) => item.parent_group_id === groupId);
      inventory.forEach((item: any) => {
        if (item.parent_group_id === groupId) {
          item.parent_group_id = null;
        }
      });

      inventory.splice(groupIndex, 1);
      localStorageHelper.save('inventory', inventory);

      // Mesma correção do fluxo online: reocupa vagas livres reivindicadas pelos pallets restaurados.
      const placeholderSlots = [null, undefined, '', 'AGUARDANDO', 'N/A', 'SEM VAGA'];
      const slots = localStorageHelper.get('warehouse_slots');
      const slotMap = new Map(slots.map((s: any) => [s.id, s]));
      const claimedSlotIds = new Set<string>();
      restoredChildren.forEach((child: any) => {
        (child.inspections || []).forEach((insp: any) => {
          if (!placeholderSlots.includes(insp.assignedSlot)) claimedSlotIds.add(insp.assignedSlot);
        });
      });
      for (const child of restoredChildren) {
        for (const insp of (child.inspections || [])) {
          const slotId = insp.assignedSlot;
          if (!slotId || !claimedSlotIds.has(slotId)) continue;
          const slot = slotMap.get(slotId) as any;
          if (slot && (!slot.status || slot.status === 'EMPTY')) {
            slot.status = insp.contentType;
            slot.occupiedBy = child.description || child.originOP || null;
            claimedSlotIds.delete(slotId);
          }
        }
      }
      localStorageHelper.save('warehouse_slots', Array.from(slotMap.values()));

      return { success: true };
    }
    
    const { data: parent, error: parentError } = await supabase.from('inventory').select('*').eq('id', groupId).single();
    if (parentError || !parent) throw new Error('Grupo não encontrado.');

    // Busca os filhos antes de restaurá-los, para saber quais vagas eles reivindicam (a consolidação
    // libera a vaga de todo filho que não seja o primeiro — ver consolidatePallets acima).
    const { data: restoredChildren, error: childrenFetchError } = await supabase.from('inventory').select('*').eq('parent_group_id', groupId);
    if (childrenFetchError) throw childrenFetchError;

    const { error: updateError } = await supabase.from('inventory').update({ parent_group_id: null }).eq('parent_group_id', groupId);
    if (updateError) throw updateError;

    const { error: deleteError } = await supabase.from('inventory').delete().eq('id', groupId);
    if (deleteError) throw deleteError;

    // Reocupa as vagas dos pallets restaurados, quando ainda estiverem livres — sem isso, um pallet
    // desconsolidado volta a aparecer "atribuído" a uma vaga que o mapa do depósito mostra como vazia.
    const placeholderSlots = [null, undefined, '', 'AGUARDANDO', 'N/A', 'SEM VAGA'];
    const claimedSlotIds = new Set<string>();
    (restoredChildren || []).forEach((child: any) => {
      (child.inspections || []).forEach((insp: any) => {
        if (!placeholderSlots.includes(insp.assignedSlot)) claimedSlotIds.add(insp.assignedSlot);
      });
    });
    if (claimedSlotIds.size > 0) {
      const { data: slotsState } = await supabase.from('warehouse_slots').select('id, status').in('id', Array.from(claimedSlotIds));
      const freeSlotIds = new Set((slotsState || []).filter((s: any) => !s.status || s.status === 'EMPTY').map((s: any) => s.id));
      for (const child of (restoredChildren || [])) {
        for (const insp of (child.inspections || [])) {
          if (insp.assignedSlot && freeSlotIds.has(insp.assignedSlot)) {
            await supabase.from('warehouse_slots').update({
              status: insp.contentType,
              occupied_by: child.description || child.origin_op || null,
              updated_at: new Date().toISOString()
            }).eq('id', insp.assignedSlot);
            freeSlotIds.delete(insp.assignedSlot);
          }
        }
      }
    }

    const { error: historyError } = await supabase.from('history').insert({
      id: historyId,
      type: 'transfer',
      loading_id: parent.loading_id,
      origin_op: parent.origin_op,
      description: parent.description,
      lot: parent.lot,
      pallets: parent.pallets,
      details: `Desconsolidação do pallet ${parent.loading_id}`,
      user_id: userId,
      user_name: userName
    });

    return { success: true };
  },

  async getGroupChildren(groupId: string): Promise<SheetRow[]> {
    if (!isSupabaseConfigured) {
      const all = localStorageHelper.get('inventory');
      return all.filter((r: any) => r.parent_group_id === groupId);
    }
    const { data, error } = await supabase
      .from('inventory')
      .select('*')
      .eq('parent_group_id', groupId);
    if (error) throw error;
    return (data || []).map(mapInventoryRow);
  },

  // Inventory
  async getInventoryPaginated(page: number, pageSize: number, filters?: { searchTerm?: string, typeFilter?: string }): Promise<{ data: SheetRow[], count: number }> {
    const getLocalInventory = () => {
      const all = localStorageHelper.get('inventory');
      let filtered = all.filter((row: any) => !row.parent_group_id);
      
      if (filters?.searchTerm) {
        const originalTerm = filters.searchTerm.trim();
        const upperTerm = originalTerm.toUpperCase();
        const term = (originalTerm || '').toLowerCase();
        const isSlot = /^[A-F](\.\d+){0,2}$/.test(upperTerm);
        const isSemSelo = upperTerm === 'SEM SELO';

        filtered = filtered.filter(row => {
          const matchesText = 
            (row.originOP || '').toLowerCase().includes(term) ||
            (row.description || '').toLowerCase().includes(term) ||
            (row.lot || '').toLowerCase().includes(term) ||
            (row.id || '').toLowerCase().includes(term) ||
            (row.loadingId || '').toLowerCase().includes(term);
          
          if (matchesText) return true;
          
          if (isSemSelo) {
             return row.inspections?.some((i: any) => i.withoutSeal);
          }
          
          if (isSlot) {
            return row.inspections?.some((i: any) => {
              const s = i.assignedSlot?.toUpperCase() || '';
              return s === upperTerm || s.startsWith(upperTerm + '.');
            });
          }

          return row.inspections?.some((i: any) => i.assignedSlot?.toLowerCase().includes(term));
        });
      }
      if (filters?.typeFilter && filters.typeFilter !== 'ALL') {
        filtered = filtered.filter(row => {
          if (filters.typeFilter === 'CONTAINER') {
             return row.inspections?.some((i: any) =>
               [SlotContent.CONTAINER_SJ, SlotContent.CONTAINER_LP, SlotContent.CONTAINER_CP].includes(i.contentType)
             );
          }
          if (filters.typeFilter === 'SEM_SELO') {
            return row.inspections?.some((i: any) => i.withoutSeal);
          }
          if (filters.typeFilter === 'DATADOS') {
            return row.inspections?.some((i: any) => i.datedBottles);
          }
          return row.inspections?.some((i: any) => i.contentType === filters.typeFilter);
        });
      }

      const from = page * pageSize;
      const to = from + pageSize;
      return {
        data: filtered.slice(from, to),
        count: filtered.length
      };
    };

    if (!isSupabaseConfigured) {
      return getLocalInventory();
    }

    try {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      let query = applyInventoryFilter(
        supabase.from('inventory').select('*', { count: 'exact' }),
        'ROOT_ONLY'
      );

      if (filters?.searchTerm) {
        const originalTerm = filters.searchTerm.trim();
        const upperTerm = originalTerm.toUpperCase();
        const term = originalTerm.toLowerCase();
        const isSlotSearch = /^[A-F](\.\d+){0,2}$/.test(upperTerm);
        const isSemSeloSearch = upperTerm === 'SEM SELO';

        try {
          const { data: searchData, error: searchErr } = await supabase.from('inventory').select('id, parent_group_id, origin_op, description, lot, loading_id, inspections').limit(1500);
          if (searchErr) console.warn("Search fetch error:", searchErr);

          if (searchData) {
            const matchedRootIds = new Set<string>();

            searchData.forEach((row: any) => {
              const matchesText = 
                (row.origin_op || '').toLowerCase().includes(term) ||
                (row.description || '').toLowerCase().includes(term) ||
                (row.lot || '').toLowerCase().includes(term) ||
                (row.id || '').toLowerCase().includes(term) ||
                (row.loading_id || '').toLowerCase().includes(term);
                
              const matchesSlot = isSlotSearch && row.inspections?.some((i:any) => i.assignedSlot?.toUpperCase().startsWith(upperTerm));
              const matchesSemSelo = isSemSeloSearch && row.inspections?.some((i:any) => i.withoutSeal);
              const matchesAssignedSlot = row.inspections?.some((i:any) => (i.assignedSlot || '').toLowerCase().includes(term));

              if (matchesText || matchesSlot || matchesSemSelo || matchesAssignedSlot) {
                if (row.parent_group_id) {
                  matchedRootIds.add(row.parent_group_id);
                } else {
                  matchedRootIds.add(row.id);
                }
              }
            });

            if (matchedRootIds.size > 0) {
              // Antes isso cortava para no máximo 30 IDs, então buscas com mais de 30 resultados
              // perdiam pallets silenciosamente (o card "sumia"). Sem corte agora.
              const idsArray = Array.from(matchedRootIds);
              query = query.in('id', idsArray);
            } else {
              query = query.eq('id', 'none_found_' + Date.now());
            }
          }
        } catch (e) {
           console.warn('Erro na busca', e);
           const termFragment = `%${originalTerm}%`;
           let orClause = `origin_op.ilike.${termFragment},description.ilike.${termFragment},lot.ilike.${termFragment},id.ilike.${termFragment},loading_id.ilike.${termFragment}`;
           query = query.or(orClause);
        }
      }

      if (filters?.typeFilter && filters.typeFilter !== 'ALL') {
        const isContainerSearch = filters.typeFilter === 'CONTAINER';
        try {
          const { data: allWithInsps, error: inspError } = await supabase.from('inventory').select('id, parent_group_id, inspections');

          if (allWithInsps && !inspError) {
            const matchedRootIds = new Set<string>();

            allWithInsps.forEach((item: any) => {
              const matches = item.inspections?.some((insp: any) => {
                if (filters.typeFilter === 'SEM_SELO') {
                  return insp.withoutSeal;
                }
                if (filters.typeFilter === 'DATADOS') {
                  return insp.datedBottles;
                }
                if (isContainerSearch) {
                  return [SlotContent.CONTAINER_SJ, SlotContent.CONTAINER_LP, SlotContent.CONTAINER_CP].includes(insp.contentType);
                }
                return insp.contentType === filters.typeFilter;
              });

              if (matches) {
                 if (item.parent_group_id) {
                   matchedRootIds.add(item.parent_group_id);
                 } else {
                   matchedRootIds.add(item.id);
                 }
              }
            });

            if (matchedRootIds.size > 0) {
              // Idem: sem o corte de 30, senão filtros como "Garrafas" ou "Insumos" com mais de 30
              // pallets no depósito mostravam só uma fatia aleatória e o resto "sumia" da tela.
              const idsArray = Array.from(matchedRootIds);
              query = query.in('id', idsArray);
            } else {
              query = query.eq('id', 'none_found_' + Date.now());
            }
          }
        } catch (e) {
          console.warn('Erro na filtragem de tipo:', e);
        }
      }

      query = query.eq('status', 'INSPECTED').order('created_at', { ascending: false }).range(from, to);

      let { data, count, error } = await query;

      if (error && isRetryableError(error)) {
        await new Promise(r => setTimeout(r, 400));
        const retryRes = await query;
        data = retryRes.data;
        count = retryRes.count;
        error = retryRes.error;
      }
      
      if (error) {
        if (isFetchOrNetworkError(error)) disableSupabase();
        console.warn('Supabase getInventoryPaginated failed, falling back to local storage:', error);
        return getLocalInventory();
      }

      return {
        data: (data || []).map(mapInventoryRow),
        count: count || 0
      };
    } catch (err: any) {
      if (isFetchOrNetworkError(err)) disableSupabase();
      console.warn('getInventoryPaginated exception, falling back to local storage:', err);
      return getLocalInventory();
    }
  },

  async getPendingInventory(): Promise<SheetRow[]> {
    const getLocalPending = () => {
      const all = localStorageHelper.get('inventory');
      return all.filter((r: any) => r.status === 'PENDING');
    };

    if (!isSupabaseConfigured) {
      return getLocalPending();
    }

    try {
      let { data, error } = await applyInventoryFilter(
        supabase.from('inventory').select('*'),
        'ROOT_ONLY'
      ).eq('status', 'PENDING').order('created_at', { ascending: false });

      if (error && isRetryableError(error)) {
        await new Promise(r => setTimeout(r, 400));
        const retryRes = await applyInventoryFilter(
          supabase.from('inventory').select('*'),
          'ROOT_ONLY'
        ).eq('status', 'PENDING').order('created_at', { ascending: false });
        data = retryRes.data;
        error = retryRes.error;
      }
      
      if (error) {
        if (isFetchOrNetworkError(error)) disableSupabase();
        console.warn('Supabase getPendingInventory failed:', error);
        return getLocalPending();
      }
      return (data || []).map(mapInventoryRow);
    } catch (err: any) {
      if (isFetchOrNetworkError(err)) disableSupabase();
      console.warn('getPendingInventory exception:', err);
      return getLocalPending();
    }
  },

  async getWaitingInventory(): Promise<SheetRow[]> {
    const getLocalWaiting = () => {
      const all = localStorageHelper.get('inventory');
      return all.filter((row: any) => row.inspections?.some((insp: any) => insp.assignedSlot === 'AGUARDANDO'));
    };

    if (!isSupabaseConfigured) return getLocalWaiting();
    try {
      const { data, error } = await applyInventoryFilter(
        supabase.from('inventory').select('*'),
        'ROOT_ONLY'
      ).neq('status', 'PENDING');
      
      if (error) {
        if (isFetchOrNetworkError(error)) disableSupabase();
        console.warn('Supabase getWaitingInventory error:', error);
        return getLocalWaiting();
      }
      const inventory = (data || []).map(mapInventoryRow);

      return inventory.filter(row => row.inspections?.some(insp => insp.assignedSlot === 'AGUARDANDO'));
    } catch (err) {
      if (isFetchOrNetworkError(err)) disableSupabase();
      console.warn('getWaitingInventory exception:', err);
      return getLocalWaiting();
    }
  },

  async getInventoryItemsByShipmentId(shipmentId: string): Promise<SheetRow[]> {
    const getLocalShipmentItems = () => {
      const all = localStorageHelper.get('inventory');
      return all.filter((r: any) => r.inspections?.some((i: any) => i.shipmentId === shipmentId || i.shipment_id === shipmentId));
    };

    if (!isSupabaseConfigured) return getLocalShipmentItems();
    
    try {
      // Use the reliable fetch-and-filter approach for JSONB content
      const { data, error } = await applyInventoryFilter(supabase.from('inventory').select('*'), 'ROOT_ONLY');

      if (error) {
        if (isFetchOrNetworkError(error)) disableSupabase();
        console.warn('Supabase getInventoryItemsByShipmentId error:', error);
        return getLocalShipmentItems();
      }

      const filtered = (data || []).filter(item => 
        Array.isArray(item.inspections) && item.inspections.some((i: any) => 
          i.shipmentId === shipmentId || i.shipment_id === shipmentId
        )
      );
      
      return filtered.map(mapInventoryRow);
    } catch (err) {
      if (isFetchOrNetworkError(err)) disableSupabase();
      console.warn('getInventoryItemsByShipmentId exception:', err);
      return getLocalShipmentItems();
    }
  },

  async getInventoryItemsByIds(ids: string[]): Promise<SheetRow[]> {
    const getLocalByIds = () => {
      const all = localStorageHelper.get('inventory');
      return all.filter((r: any) => ids.includes(r.id));
    };

    if (!isSupabaseConfigured) return getLocalByIds();

    try {
      const { data, error } = await supabase
        .from('inventory')
        .select('*')
        .in('id', ids);
      
      if (error) {
        if (isFetchOrNetworkError(error)) disableSupabase();
        console.warn('Supabase getInventoryItemsByIds error:', error);
        return getLocalByIds();
      }

      return (data || [])
        .map(mapInventoryRow)
        .filter(item => Array.isArray(item.inspections) && item.inspections.length > 0);
    } catch (err) {
      if (isFetchOrNetworkError(err)) disableSupabase();
      console.warn('getInventoryItemsByIds exception:', err);
      return getLocalByIds();
    }
  },

  async getAllInventoryForExport(filters?: { searchTerm?: string, typeFilter?: string, includeGrouped?: boolean }): Promise<SheetRow[]> {
    const getLocalExport = () => {
      const all = localStorageHelper.get('inventory');
      return all.filter((item: any) => Array.isArray(item.inspections) && item.inspections.length > 0);
    };

    if (!isSupabaseConfigured) return getLocalExport();
    try {

    let query = applyInventoryFilter(supabase.from('inventory').select('*'), filters?.includeGrouped ? 'ALL' : 'ROOT_ONLY');

    if (filters?.searchTerm) {
      const originalTerm = filters.searchTerm.trim();
      const upperTerm = originalTerm.toUpperCase();
      const termFragment = `%${originalTerm}%`;
      const isSlot = /^[A-F](\.\d+){0,2}$/.test(upperTerm);
      
      let orClause = `origin_op.ilike.${termFragment},description.ilike.${termFragment},lot.ilike.${termFragment},id.ilike.${termFragment},loading_id.ilike.${termFragment}`;
      const isSemSeloSearch = upperTerm === 'SEM SELO';

      if (isSlot || isSemSeloSearch) {
        try {
          const { data: allWithInsps } = await supabase
            .from('inventory')
            .select('id, inspections');
          
          if (allWithInsps) {
            const palletsInTargetSlots = allWithInsps.filter(p => 
              p.inspections?.some((insp: any) => 
                (isSlot && insp.assignedSlot?.toUpperCase().startsWith(upperTerm)) ||
                (isSemSeloSearch && insp.withoutSeal)
              )
            ).map(p => p.id);

            if (palletsInTargetSlots.length > 0) {
              orClause += `,id.in.(${palletsInTargetSlots.join(',')})`;
            }
          }
        } catch (e) {
          console.warn('Erro ao processar busca por vaga (export):', e);
        }
      }
      
      query = query.or(orClause);
    }

    if (filters?.typeFilter && filters.typeFilter !== 'ALL') {
      const isContainerSearch = filters.typeFilter === 'CONTAINER';
      const { data: allWithInsps, error: inspError } = await supabase.from('inventory').select('id, inspections');
      
      if (allWithInsps && !inspError) {
        const matchingIds = allWithInsps.filter(item => 
          item.inspections?.some((insp: any) => {
            if (filters.typeFilter === 'SEM_SELO') {
              return insp.withoutSeal;
            }
            if (filters.typeFilter === 'DATADOS') {
              return insp.datedBottles;
            }
            if (isContainerSearch) {
              return [SlotContent.CONTAINER_SJ, SlotContent.CONTAINER_LP, SlotContent.CONTAINER_CP].includes(insp.contentType);
            }
            return insp.contentType === filters.typeFilter;
          })
        ).map(i => i.id);

        if (matchingIds.length > 0) {
          // Sem corte de IDs: antes limitava a 150 e exportava incompleto.
          query = query.in('id', matchingIds);
        } else {
          query = query.eq('id', 'none_found_export_' + Date.now());
        }
      }
    }

      const { data, error } = await query.order('created_at', { ascending: false });
      
      if (error) {
        if (isFetchOrNetworkError(error)) disableSupabase();
        console.warn('Supabase getAllInventoryForExport error:', error);
        return getLocalExport();
      }

      // Filter out items with empty inspections as they are considered "out of stock"
      const validItems = (data || []).filter(item => Array.isArray(item.inspections) && item.inspections.length > 0);

      return validItems.map(mapInventoryRow);
    } catch (err) {
      if (isFetchOrNetworkError(err)) disableSupabase();
      console.warn('getAllInventoryForExport exception:', err);
      return getLocalExport();
    }
  },

  async searchOpOrProduct(searchTerm: string): Promise<AutocompleteItem[]> {
    if (!searchTerm || searchTerm.trim().length < 2) return [];

    const raw = searchTerm.trim();
    const formatted = formatOP(raw);
    const upperRaw = raw.toUpperCase();
    const upperFormatted = formatted.toUpperCase();

    const resultsMap = new Map<string, AutocompleteItem>();

    const addItem = (item: AutocompleteItem) => {
      const opNorm = (item.originOP || '').trim().toUpperCase();
      const descNorm = (item.description || '').trim().toUpperCase();
      const lotNorm = (item.lot || '').trim().toUpperCase();
      const key = `${opNorm}_${descNorm}_${lotNorm}_${item.contentType}`;
      if (!resultsMap.has(key)) {
        resultsMap.set(key, item);
      }
    };

    if (!isSupabaseConfigured) {
      const inv: any[] = localStorageHelper.get('inventory') || [];
      const hist: any[] = localStorageHelper.get('history') || [];

      // Search in inventory
      inv.forEach(row => {
        const op = (row.origin_op || row.originOP || '').toUpperCase();
        const desc = (row.description || '').toUpperCase();
        const lot = (row.lot || '').toUpperCase();

        if (
          op.includes(upperRaw) || op.includes(upperFormatted) ||
          desc.includes(upperRaw) || lot.includes(upperRaw)
        ) {
          const insp = row.inspections?.[0];
          const cType = insp?.contentType ? parseSlotContent(insp.contentType) : SlotContent.FINISHED_PRODUCT;
          let totalUnits = 0;
          if (insp) {
            totalUnits = (insp.bottles || 0) + (insp.boxes || 0) + (insp.caps || 0) + (insp.cradles || 0);
            if (insp.others && Array.isArray(insp.others)) {
              totalUnits += insp.others.reduce((acc: number, cur: any) => acc + (Number(cur.quantity) || 0), 0);
            }
          }
          addItem({
            originOP: row.origin_op || row.originOP || '',
            description: row.description || '',
            lot: row.lot || '',
            contentType: cType,
            units: totalUnits > 0 ? totalUnits : (row.pallets || 1),
            supplyDetails: cType === SlotContent.SUPPLIES && insp ? {
              frascos: insp.bottles || 0,
              tampas: insp.caps || 0,
              caixas: insp.boxes || 0,
              bercos: insp.cradles || 0,
              extras: (insp.others || []).map((o: any) => ({ id: Math.random().toString(), name: o.name, quantity: Number(o.quantity) || 0 }))
            } : undefined,
            reworkObs: insp?.reworkObs || '',
            source: 'inventory'
          });
        }
      });

      // Search in history
      hist.forEach(h => {
        const op = (h.op || h.origin_op || '').toUpperCase();
        const desc = (h.description || '').toUpperCase();
        const lot = (h.lot || '').toUpperCase();

        if (
          op.includes(upperRaw) || op.includes(upperFormatted) ||
          desc.includes(upperRaw) || lot.includes(upperRaw)
        ) {
          const cType = parseSlotContent(h.pallet_type || h.palletType);
          addItem({
            originOP: h.op || h.origin_op || '',
            description: h.description || '',
            lot: h.lot || '',
            contentType: cType,
            source: 'history'
          });
        }
      });

      return Array.from(resultsMap.values()).slice(0, 15);
    }

    try {
      // 1. Search in inventory table
      const termFragmentRaw = `%${raw}%`;
      const termFragmentFmt = `%${formatted}%`;
      
      const invQuery = supabase
        .from('inventory')
        .select('origin_op, description, lot, pallets, inspections')
        .or(`origin_op.ilike.${termFragmentRaw},origin_op.ilike.${termFragmentFmt},description.ilike.${termFragmentRaw},lot.ilike.${termFragmentRaw}`)
        .order('created_at', { ascending: false })
        .limit(20);

      // 2. Search in history table
      const histQuery = supabase
        .from('history')
        .select('op, description, lot, pallet_type, details')
        .or(`op.ilike.${termFragmentRaw},op.ilike.${termFragmentFmt},description.ilike.${termFragmentRaw},lot.ilike.${termFragmentRaw}`)
        .order('created_at', { ascending: false })
        .limit(20);

      const [invRes, histRes] = await Promise.all([invQuery, histQuery]);

      if (invRes.data) {
        invRes.data.forEach((row: any) => {
          if (!row.origin_op && !row.description) return;
          const insp = Array.isArray(row.inspections) && row.inspections.length > 0 ? row.inspections[0] : null;
          const cType = insp?.contentType ? parseSlotContent(insp.contentType) : SlotContent.FINISHED_PRODUCT;
          
          let totalUnits = 0;
          if (insp) {
            totalUnits = (insp.bottles || 0) + (insp.boxes || 0) + (insp.caps || 0) + (insp.cradles || 0);
            if (insp.others && Array.isArray(insp.others)) {
              totalUnits += insp.others.reduce((acc: number, cur: any) => acc + (Number(cur.quantity) || 0), 0);
            }
          }

          addItem({
            originOP: row.origin_op || '',
            description: row.description || '',
            lot: row.lot || '',
            contentType: cType,
            units: totalUnits > 0 ? totalUnits : (row.pallets || 1),
            supplyDetails: cType === SlotContent.SUPPLIES && insp ? {
              frascos: insp.bottles || 0,
              tampas: insp.caps || 0,
              caixas: insp.boxes || 0,
              bercos: insp.cradles || 0,
              extras: (insp.others || []).map((o: any) => ({ id: Math.random().toString(), name: o.name, quantity: Number(o.quantity) || 0 }))
            } : undefined,
            reworkObs: insp?.reworkObs || '',
            source: 'inventory'
          });
        });
      }

      if (histRes.data) {
        histRes.data.forEach((h: any) => {
          if (!h.op && !h.description) return;
          const cType = parseSlotContent(h.pallet_type);
          addItem({
            originOP: h.op || '',
            description: h.description || '',
            lot: h.lot || '',
            contentType: cType,
            source: 'history'
          });
        });
      }
    } catch (e) {
      console.warn('Erro ao buscar autocomplete:', e);
    }

    return Array.from(resultsMap.values()).slice(0, 15);
  },

  async getGlobalStats(): Promise<DashboardStats> {
    const computeStatsFromLocal = (): DashboardStats => {
      const allSlots = localStorageHelper.get('warehouse_slots') || [];
      const inventory = localStorageHelper.get('inventory') || [];
      const history = localStorageHelper.get('history') || [];
      const shipments = localStorageHelper.get('shipments') || [];

      const generalSlots = allSlots.filter((s: any) => s.id?.startsWith('A') || s.id?.startsWith('B') || s.id?.startsWith('C') || s.id?.startsWith('D'));
      const totalGeneral = generalSlots.length > 0 ? generalSlots.length : 198;
      const occupiedGeneralPhysical = generalSlots.filter((s: any) => 
        (s.status && s.status !== 'EMPTY' && s.status !== 'empty') || isDedicatedFinishedProductSlot(s.id)
      ).length;

      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const movements24h = history.filter((h: any) => new Date(h.created_at || h.timestamp).getTime() >= oneDayAgo).length;
      const finishedShipments = shipments.filter((s: any) => s.status === 'CLOSED' && new Date(s.closed_at).getTime() >= oneDayAgo).length;
      const pendingCount = inventory.filter((item: any) => item.status === 'PENDING').length;

      let totalBottles = 0;
      let waitingPalletsGeneral = 0;
      const productDistribution: Record<string, number> = {};
      const uniqueOps = new Set<string>();

      inventory.filter((item: any) => !item.parent_group_id && item.status !== 'PENDING').forEach((item: any) => {
        const hasRelevantMaterial = (item.inspections || []).some((insp: any) => {
          return insp.contentType === 'BOTTLES' || insp.contentType === 'SUPPLIES';
        });

        if (hasRelevantMaterial && item.origin_op) {
          const normalizedOp = formatOP(item.origin_op);
          if (normalizedOp) uniqueOps.add(normalizedOp);
        }

        (item.inspections || []).forEach((insp: any) => {
          totalBottles += (insp.bottles || 0);
          if (insp.assignedSlot === 'AGUARDANDO') {
            const type = insp.contentType || 'OTHER';
            if (!['CONTAINER_SJ', 'CONTAINER_LP', 'CONTAINER_CP'].includes(type)) {
              waitingPalletsGeneral += 1;
            }
          }
          const type = insp.contentType || 'OTHER';
          productDistribution[type] = (productDistribution[type] || 0) + 1;
        });
      });

      const freeSlots = Math.max(0, totalGeneral - occupiedGeneralPhysical);
      const occupiedSlots = occupiedGeneralPhysical + waitingPalletsGeneral;
      const occupancyRate = totalGeneral > 0 ? Math.round((occupiedSlots / totalGeneral) * 100) : 0;

      return {
        totalSlots: totalGeneral,
        occupiedSlots,
        freeSlots,
        occupancyRate,
        pendingEntries: pendingCount,
        dailyMovements: movements24h,
        finishedShipments24h: finishedShipments,
        totalBottles,
        waitingPallets: waitingPalletsGeneral,
        productDistribution,
        uniqueSkuCount: uniqueOps.size
      };
    };

    if (!isSupabaseConfigured) {
      return computeStatsFromLocal();
    }

    try {
      const results = await Promise.all([
        supabase.from('warehouse_slots').select('id, status'),
        applyInventoryFilter(supabase.from('inventory').select('*', { count: 'exact', head: true }), 'ROOT_ONLY').eq('status', 'PENDING'),
        supabase.from('history').select('*', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
        supabase.from('shipments').select('*', { count: 'exact', head: true }).eq('status', 'CLOSED').gte('closed_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
        applyInventoryFilter(supabase.from('inventory').select('inspections, parent_group_id, origin_op, status'), 'ROOT_ONLY').neq('status', 'PENDING') 
      ]);

      const allSlots = results[0].data || [];
      const pendingCount = results[1].count || 0;
      const movements24h = results[2].count || 0;
      const finishedShipments = results[3].count || 0;
      const allInspections = (results[4].data || []).filter(item => Array.isArray(item.inspections) && item.inspections.length > 0);

      // Filter slots by category
      const generalSlots = allSlots.filter(s => s.id.startsWith('A') || s.id.startsWith('B') || s.id.startsWith('C') || s.id.startsWith('D'));

      const totalGeneral = generalSlots.length > 0 ? generalSlots.length : 198;
      const occupiedGeneralPhysical = generalSlots.filter(s => 
        (s.status && s.status !== 'EMPTY' && s.status !== 'empty') || isDedicatedFinishedProductSlot(s.id)
      ).length;
      
      let totalBottles = 0;
      let waitingPallets = 0;
      let waitingPalletsGeneral = 0;
      const productDistribution: Record<string, number> = {};
      const uniqueOps = new Set<string>();

      allInspections.forEach(item => {
        // Find OPs
        const hasRelevantMaterial = (item.inspections || []).some((insp: any) => {
          return insp.contentType === 'BOTTLES' || insp.contentType === 'SUPPLIES';
        });

        if (hasRelevantMaterial && item.origin_op) {
          const normalizedOp = formatOP(item.origin_op);
          if (normalizedOp) {
            uniqueOps.add(normalizedOp);
          }
        }

        (item.inspections || []).forEach((insp: any) => {
          totalBottles += (insp.bottles || 0);
          if (insp.assignedSlot === 'AGUARDANDO') {
            waitingPallets += 1;
            const type = insp.contentType || 'OTHER';
            if (!['CONTAINER_SJ', 'CONTAINER_LP', 'CONTAINER_CP'].includes(type)) {
              waitingPalletsGeneral += 1;
            }
          }
          
          // Count content type distribution
          const type = insp.contentType || 'OTHER';
          productDistribution[type] = (productDistribution[type] || 0) + 1;
        });
      });

      const freeSlots = Math.max(0, totalGeneral - occupiedGeneralPhysical);
      const occupiedSlots = occupiedGeneralPhysical + waitingPalletsGeneral;
      const occupancyRate = totalGeneral > 0 ? Math.round((occupiedSlots / totalGeneral) * 100) : 0;

      return {
        totalSlots: totalGeneral,
        occupiedSlots,
        freeSlots,
        occupancyRate,
        pendingEntries: pendingCount,
        dailyMovements: movements24h,
        finishedShipments24h: finishedShipments,
        totalBottles,
        waitingPallets: waitingPalletsGeneral,
        productDistribution,
        uniqueSkuCount: uniqueOps.size
      };
    } catch (err) {
      if (isFetchOrNetworkError(err)) disableSupabase();
      console.warn('getGlobalStats exception, returning local computed stats:', err);
      return computeStatsFromLocal();
    }
  },

  async saveInventoryItem(item: SheetRow) {
    if (isSupabaseConfigured) {
      try {
        let { error } = await supabase
          .from('inventory')
          .upsert({
            id: item.id,
            loading_id: item.loadingId,
            origin_op: item.originOP,
            description: item.description,
            lot: item.lot,
            pallets: item.pallets,
            date: item.date,
            status: item.status,
            inspections: item.inspections || [],
            operator_name: item.operatorName
          });
        
        if (error && isRetryableError(error)) {
          await new Promise(r => setTimeout(r, 400));
          const retryRes = await supabase
            .from('inventory')
            .upsert({
              id: item.id,
              loading_id: item.loadingId,
              origin_op: item.originOP,
              description: item.description,
              lot: item.lot,
              pallets: item.pallets,
              date: item.date,
              status: item.status,
              inspections: item.inspections || [],
              operator_name: item.operatorName
            });
          error = retryRes.error;
        }

        if (error) {
          console.warn('Supabase saveInventoryItem issue, saved locally:', error.message || error);
        }
      } catch (err: any) {
        console.warn('Supabase saveInventoryItem exception, saved locally:', err?.message || err);
      }
    }
    localStorageHelper.update('inventory', item);
    this.broadcastAppEvent('inventory:saved', { item });
  },

  async deleteInventoryItem(id: string) {
    if (isSupabaseConfigured) {
      try {
        let { error } = await supabase
          .from('inventory')
          .delete()
          .eq('id', id);
        
        if (error && isRetryableError(error)) {
          await new Promise(r => setTimeout(r, 400));
          const retryRes = await supabase
            .from('inventory')
            .delete()
            .eq('id', id);
          error = retryRes.error;
        }

        if (error) {
          console.warn('Supabase deleteInventoryItem issue, deleted locally:', error.message || error);
        }
      } catch (err: any) {
        console.warn('Supabase deleteInventoryItem exception, deleted locally:', err?.message || err);
      }
    }
    const current = localStorageHelper.get('inventory');
    localStorageHelper.save('inventory', current.filter((item: any) => item.id !== id));
    this.broadcastAppEvent('inventory:deleted', { id });
  },

  // Slots
  async getSlots(): Promise<WarehouseSlot[]> {
    if (!isSupabaseConfigured) return localStorageHelper.get('warehouse_slots');

    try {
      let { data, error } = await supabase
        .from('warehouse_slots')
        .select('*')
        .order('rack')
        .order('level')
        .order('position');
      
      if (error && isRetryableError(error)) {
        await new Promise(r => setTimeout(r, 400));
        const retryRes = await supabase
          .from('warehouse_slots')
          .select('*')
          .order('rack')
          .order('level')
          .order('position');
        data = retryRes.data;
        error = retryRes.error;
      }

      if (error) {
        if (isFetchOrNetworkError(error)) disableSupabase();
        console.warn('Supabase getSlots failed, falling back to local storage:', error);
        return localStorageHelper.get('warehouse_slots');
      }
      const slots = (data || []).map(slot => ({
        id: slot.id,
        rack: slot.rack as any,
        level: slot.level,
        position: slot.position,
        status: slot.status as SlotContent,
        occupiedBy: slot.occupied_by
      }));
      localStorageHelper.save('warehouse_slots', slots);
      return slots;
    } catch (err) {
      if (isFetchOrNetworkError(err)) disableSupabase();
      console.warn('getSlots exception, falling back to local storage:', err);
      return localStorageHelper.get('warehouse_slots');
    }
  },

  async getSlotById(id: string): Promise<WarehouseSlot | null> {
    if (!isSupabaseConfigured) {
      const all = localStorageHelper.get('warehouse_slots');
      return all.find((s: any) => s.id === id) || null;
    }
    try {
      const { data, error } = await supabase
        .from('warehouse_slots')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      
      if (error) {
        if (isFetchOrNetworkError(error)) disableSupabase();
        const all = localStorageHelper.get('warehouse_slots');
        return all.find((s: any) => s.id === id) || null;
      }
      if (!data) return null;

      return {
        id: data.id,
        rack: data.rack as any,
        level: data.level,
        position: data.position,
        status: data.status as SlotContent,
        occupiedBy: data.occupied_by
      };
    } catch (err) {
      if (isFetchOrNetworkError(err)) disableSupabase();
      const all = localStorageHelper.get('warehouse_slots');
      return all.find((s: any) => s.id === id) || null;
    }
  },

  async updateSlot(slot: WarehouseSlot) {
    if (isSupabaseConfigured) {
      try {
        let { error } = await supabase
          .from('warehouse_slots')
          .upsert({
            id: slot.id,
            rack: slot.rack,
            level: slot.level,
            position: slot.position,
            status: slot.status,
            occupied_by: slot.occupiedBy,
            updated_at: new Date().toISOString()
          });
        
        if (error && isRetryableError(error)) {
          await new Promise(r => setTimeout(r, 400));
          const retryRes = await supabase
            .from('warehouse_slots')
            .upsert({
              id: slot.id,
              rack: slot.rack,
              level: slot.level,
              position: slot.position,
              status: slot.status,
              occupied_by: slot.occupiedBy,
              updated_at: new Date().toISOString()
            });
          error = retryRes.error;
        }

        if (error) {
          console.warn('Supabase updateSlot issue, saved locally:', error.message || error);
        }
      } catch (err: any) {
        console.warn('Supabase updateSlot exception, saved locally:', err?.message || err);
      }
    }
    localStorageHelper.update('warehouse_slots', slot);
    this.broadcastAppEvent('slot:updated', { slot });
  },

  async bulkUpdateSlots(slots: WarehouseSlot[]) {
    if (isSupabaseConfigured) {
      try {
        const { error } = await supabase
          .from('warehouse_slots')
          .upsert(slots.map(slot => ({
            id: slot.id,
            rack: slot.rack,
            level: slot.level,
            position: slot.position,
            status: slot.status,
            occupied_by: slot.occupiedBy,
            updated_at: new Date().toISOString()
          })))
          .select();
        if (error && isFetchOrNetworkError(error)) {
          console.warn('Supabase bulkUpdateSlots network issue, saved locally:', error);
        }
      } catch (err) {
        if (isFetchOrNetworkError(err)) {
          console.warn('Supabase bulkUpdateSlots exception, saved locally:', err);
        }
      }
    }
    const current = localStorageHelper.get('warehouse_slots');
    const slotMap = new Map(current.map((s: any) => [s.id, s]));
    slots.forEach(s => slotMap.set(s.id, s));
    localStorageHelper.save('warehouse_slots', Array.from(slotMap.values()));
    this.broadcastAppEvent('slots:bulk_updated', { slots });
  },

  // History
  // Kept for backward compatibility (offline fallback / callers that still want everything).
  async getHistory(): Promise<HistoryEntry[]> {
    if (!isSupabaseConfigured) return localStorageHelper.get('history');

    // Busca paginada: uma única query sem .range() é limitada pelo teto padrão de linhas do
    // PostgREST (geralmente 1000), então tabelas maiores que isso eram truncadas silenciosamente
    // (por exemplo, num backup completo). Aqui varremos página por página até esgotar os dados.
    const PAGE = 1000;
    const all: any[] = [];
    let fromIdx = 0;

    while (true) {
      const { data, error } = await supabase
        .from('history')
        .select('*')
        .order('created_at', { ascending: false })
        .range(fromIdx, fromIdx + PAGE - 1);

      if (error) {
        console.warn('Supabase getHistory failed, falling back to local storage:', error);
        return localStorageHelper.get('history');
      }

      all.push(...(data || []));
      if (!data || data.length < PAGE) break;
      fromIdx += PAGE;
    }

    const history = all.map(mapHistoryRow);
    localStorageHelper.save('history', history);
    return history;
  },

  // Paginated history load, with a real server-side search (ILIKE against the whole table,
  // not just whatever page happens to be loaded). page is 0-indexed.
  async getHistoryPaginated(page: number, pageSize: number, searchTerm?: string): Promise<{ data: HistoryEntry[], count: number }> {
    const term = (searchTerm || '').trim();

    if (!isSupabaseConfigured) {
      let all: HistoryEntry[] = localStorageHelper.get('history');
      if (term) {
        const lower = term.toLowerCase();
        all = all.filter((entry: HistoryEntry) =>
          (entry.op || '').toLowerCase().includes(lower) ||
          (entry.description || '').toLowerCase().includes(lower) ||
          (entry.lot || '').toLowerCase().includes(lower) ||
          (entry.details || '').toLowerCase().includes(lower) ||
          (entry.loadingId || '').toLowerCase().includes(lower) ||
          (entry.slot || '').toLowerCase().includes(lower) ||
          (entry.operatorName || '').toLowerCase().includes(lower)
        );
      }
      const from = page * pageSize;
      const to = from + pageSize;
      return { data: all.slice(from, to), count: all.length };
    }

    const from = page * pageSize;
    const to = from + pageSize - 1;

    const buildQuery = () => {
      let q = supabase
        .from('history')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (term) {
        // Escape characters that have special meaning inside PostgREST's or()/ilike() syntax
        const escaped = term.replace(/[%_,()]/g, (c) => `\\${c}`);
        const pattern = `%${escaped}%`;
        q = q.or(
          [
            `op.ilike.${pattern}`,
            `description.ilike.${pattern}`,
            `lot.ilike.${pattern}`,
            `details.ilike.${pattern}`,
            `loading_id.ilike.${pattern}`,
            `slot.ilike.${pattern}`,
            `operator_name.ilike.${pattern}`
          ].join(',')
        );
      }
      return q;
    };

    try {
      let { data, error, count } = await buildQuery().range(from, to);

      if (error && isRetryableError(error)) {
        await new Promise(r => setTimeout(r, 400));
        const retryRes = await buildQuery().range(from, to);
        data = retryRes.data;
        error = retryRes.error;
        count = retryRes.count;
      }

      if (error) {
        console.warn('Supabase getHistoryPaginated warning, falling back to local storage:', error.message || error.code);
        const local = localStorageHelper.get('history');
        return { data: local.slice(page * pageSize, page * pageSize + pageSize), count: local.length };
      }

      return { data: (data || []).map(mapHistoryRow), count: count || 0 };
    } catch (err: any) {
      console.warn('Supabase getHistoryPaginated exception, falling back to local storage:', err);
      const local = localStorageHelper.get('history');
      return { data: local.slice(page * pageSize, page * pageSize + pageSize), count: local.length };
    }
  },

  async addHistoryEntry(entry: HistoryEntry) {
    if (isSupabaseConfigured) {
      try {
        let { error } = await supabase
          .from('history')
          .insert({
            id: entry.id,
            type: entry.type,
            timestamp: entry.timestamp,
            loading_id: entry.loadingId,
            description: entry.description,
            op: entry.op,
            lot: entry.lot,
            pallet_number: entry.palletNumber,
            total_pallets: entry.totalPallets,
            slot: entry.slot,
            details: entry.details,
            operator_name: entry.operatorName,
            pallet_type: entry.palletType
          });
        
        if (error && isRetryableError(error)) {
          await new Promise(r => setTimeout(r, 400));
          const retryRes = await supabase
            .from('history')
            .insert({
              id: entry.id,
              type: entry.type,
              timestamp: entry.timestamp,
              loading_id: entry.loadingId,
              description: entry.description,
              op: entry.op,
              lot: entry.lot,
              pallet_number: entry.palletNumber,
              total_pallets: entry.totalPallets,
              slot: entry.slot,
              details: entry.details,
              operator_name: entry.operatorName,
              pallet_type: entry.palletType
            });
          error = retryRes.error;
        }

        if (error) {
          if ((error.code === '42703' || error.code === 'PGRST204') && error.message?.includes('pallet_type')) {
            console.warn('Column pallet_type missing, retrying without it');
            const { error: retryError } = await supabase
              .from('history')
              .insert({
                id: entry.id,
                type: entry.type,
                timestamp: entry.timestamp,
                loading_id: entry.loadingId,
                description: entry.description,
                op: entry.op,
                lot: entry.lot,
                pallet_number: entry.palletNumber,
                total_pallets: entry.totalPallets,
                slot: entry.slot,
                details: entry.details,
                operator_name: entry.operatorName
              });
              
            if (retryError) {
               console.warn('Supabase addHistoryEntry retry warning:', retryError);
            }
          } else {
            console.warn('Supabase addHistoryEntry warning:', error);
          }
        }
      } catch (err: any) {
        console.warn('Supabase addHistoryEntry exception:', err);
      }
    }
    localStorageHelper.add('history', entry);
    this.broadcastAppEvent('history:saved', { entry });
  },

  // Auth
  async signIn(username: string, password: string) {
    if (!isSupabaseConfigured) {
      // Mock login for offline mode
      const mockUser = {
        id: 'offline-user',
        email: `${username}@stoqueplus.com`,
      };
      localStorage.setItem('stoque_plus_logged_user', JSON.stringify({
        id: mockUser.id,
        name: username,
        role: (username || '').toLowerCase() === 'admin' ? 'admin' : 'operator'
      }));
      return { user: mockUser, session: { access_token: 'mock-token' } };
    }

    // We append a domain to the username to use Supabase Auth's email system
    const email = `${(username || '').toLowerCase().trim()}@stoqueplus.com`;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      return data;
    } catch (error: any) {
      if (error?.message === 'Failed to fetch' || error?.message?.includes('fetch') || error?.toString().includes('Failed to fetch')) {
        disableSupabase();
        // Return mock login
        const mockUser = {
          id: 'offline-user',
          email: `${username}@stoqueplus.com`,
        };
        localStorage.setItem('stoque_plus_logged_user', JSON.stringify({
          id: mockUser.id,
          name: username,
          role: (username || '').toLowerCase() === 'admin' ? 'admin' : 'operator'
        }));
        return { user: mockUser, session: { access_token: 'mock-token' } };
      }
      throw error;
    }
  },

  async signOut() {
    if (!isSupabaseConfigured) {
      localStorage.removeItem('stoque_plus_logged_user');
      return;
    }
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error: any) {
      if (error?.message === 'Failed to fetch' || error?.message?.includes('fetch') || error?.toString().includes('Failed to fetch')) {
        disableSupabase();
        localStorage.removeItem('stoque_plus_logged_user');
        return;
      }
      throw error;
    }
  },

  async getCurrentUser() {
    if (!isSupabaseConfigured) {
      const localUser = localStorage.getItem('stoque_plus_logged_user');
      return localUser ? JSON.parse(localUser) : null;
    }

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) return null;

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) return null;
      
      // Get profile info (name)
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      
      if (!profile) {
        // If profile doesn't exist but user does, create a default one
        const newProfile = {
          id: user.id,
          name: user.email?.split('@')[0] || 'Usuário',
          role: 'operator',
          active: true
        };
        await supabase.from('profiles').insert(newProfile);
        return {
          id: user.id,
          name: newProfile.name,
          role: 'operator'
        } as User;
      }

      if (!profile.active) {
        await this.signOut();
        throw new Error('Sua conta está desativada. Entre em contato com o administrador.');
      }

      return {
        id: user.id,
        name: profile.name || user.email?.split('@')[0] || 'Usuário',
        role: profile.role || 'operator'
      } as User;
    } catch (error: any) {
      if (error?.message?.includes('stole it') || error?.message?.includes('lock')) {
        console.warn('Supabase Auth lock warning ignored:', error);
        return null;
      }
      if (isFetchOrNetworkError(error)) {
        console.warn('Supabase getCurrentUser network issue, falling back to local user:', error?.message || error);
        disableSupabase();
        const localUser = localStorage.getItem('stoque_plus_logged_user');
        return localUser ? JSON.parse(localUser) : null;
      }
      console.warn('Error in getCurrentUser, falling back to local user:', error?.message || error);
      const localUser = localStorage.getItem('stoque_plus_logged_user');
      return localUser ? JSON.parse(localUser) : null;
    }
  },

  async getProfiles() {
    if (!isSupabaseConfigured) return [];
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: true });
      
      if (error) {
        if (isFetchOrNetworkError(error)) disableSupabase();
        console.warn('getProfiles error:', error);
        return [];
      }
      return (data || []).map(p => ({
        id: p.id,
        name: p.name,
        role: p.role,
        active: p.active,
        createdAt: p.created_at
      }));
    } catch (err) {
      if (isFetchOrNetworkError(err)) disableSupabase();
      console.warn('getProfiles exception:', err);
      return [];
    }
  },

  async updateProfile(id: string, updates: { name?: string, role?: string, active?: boolean }) {
    if (isSupabaseConfigured) {
      // Step 0: Verify if current user is admin
      const currentUser = await this.getCurrentUser();
      if (!currentUser || currentUser.role !== 'admin') {
        throw new Error('Apenas administradores podem gerenciar perfis.');
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);
      
      if (error) throw error;
    }
  },

  async signUpNewUser(username: string, name: string, password: string, role: 'admin' | 'operator') {
    if (!isSupabaseConfigured) {
      throw new Error('O Supabase não está configurado.');
    }

    // Step 0: Verify if current user is admin
    const currentUser = await this.getCurrentUser();
    if (!currentUser || currentUser.role !== 'admin') {
      throw new Error('Apenas administradores podem criar novos usuários.');
    }

    const email = `${(username || '').toLowerCase().trim()}@stoqueplus.com`;
    
    // Step 1: Create a temporary client that doesn't persist session
    // This prevents the admin from being logged out when creating a new user
    const tempClient = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      }
    );

    // Step 2: Sign up in Auth using the temp client
    const { data: signUpData, error: signUpError } = await tempClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name
        }
      }
    });

    if (signUpError) throw signUpError;
    if (!signUpData.user) throw new Error('Não foi possível criar o usuário no Auth.');

    // Step 3: Create the profile using the MAIN supabase client (authenticating as Admin)
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: signUpData.user.id,
        name: name,
        role: role,
        active: true
      });
    
    if (profileError) throw profileError;
    
    return signUpData;
  },

  // Edit Requests
  async createEditRequest(request: {
    inventory_id: string,
    requested_by: string,
    before_data: any,
    after_data: any,
    reason: string
  }) {
    if (!isSupabaseConfigured) throw new Error('O Supabase não está configurado.');
    const { data, error } = await supabase
      .from('inventory_edit_requests')
      .insert(request)
      .select()
      .single();
    
    if (error) throw error;
    this.broadcastAppEvent('approval:requested', { request: data });
    return data;
  },

  async findPalletByLoadingId(id: string) {
    const getLocal = () => {
      const all = localStorageHelper.get('inventory');
      return all.find((row: any) => row.loadingId === id || row.id === id) || null;
    };

    if (!isSupabaseConfigured) {
      return getLocal();
    }

    try {
      const { data, error } = await supabase
        .from('inventory')
        .select('*')
        .or(`loading_id.eq."${id}",id.eq."${id}"`)
        .maybeSingle();

      if (error) {
        if (isFetchOrNetworkError(error)) disableSupabase();
        return getLocal();
      }
      if (!data) return null;

      if (!data.inspections || (Array.isArray(data.inspections) && data.inspections.length === 0)) {
        if (data.status !== 'PENDING') return null;
      }

      // Map to application standard (SheetRow)
      return {
        id: data.id,
        loadingId: data.loading_id,
        originOP: data.origin_op,
        description: data.description,
        lot: data.lot,
        pallets: data.pallets,
        date: data.date || data.created_at,
        status: data.status as StockStatus,
        operatorName: data.operator_name,
        inspections: data.inspections || [],
      } as SheetRow;
    } catch (err) {
      if (isFetchOrNetworkError(err)) disableSupabase();
      return getLocal();
    }
  },

  async findPalletsBySlot(slotId: string) {
    const getLocal = () => {
      const all = localStorageHelper.get('inventory');
      return all.filter((row: any) => row.inspections?.some((i: any) => i.assignedSlot === slotId));
    };

    if (!isSupabaseConfigured) {
      return getLocal();
    }

    try {
      // Fetching and filtering in JS is safer against inconsistent JSONB structures (array vs object)
      // that cause Postgrest syntax errors.
      const { data, error } = await applyInventoryFilter(
        supabase.from('inventory').select('*'),
        'ROOT_ONLY'
      );

      if (error) {
        if (isFetchOrNetworkError(error)) disableSupabase();
        return getLocal();
      }
      if (!data) return [];

      const matched = data.filter((item: any) => {
        const insps = Array.isArray(item.inspections) ? item.inspections : 
                     (item.inspections ? [item.inspections] : []);
        return insps.some((i: any) => i.assignedSlot === slotId);
      });

      return matched.map((item: any) => ({
        id: item.id,
        loadingId: item.loading_id,
        originOP: item.origin_op,
        description: item.description,
        lot: item.lot,
        pallets: item.pallets,
        date: item.date || item.created_at,
        status: item.status as StockStatus,
        operatorName: item.operator_name,
        inspections: item.inspections || [],
      })) as SheetRow[];
    } catch (err) {
      if (isFetchOrNetworkError(err)) disableSupabase();
      return getLocal();
    }
  },

  
  async getPendingEditRequestsCount(): Promise<number> {
    if (!isSupabaseConfigured) return 0;
    try {
      const { count, error } = await supabase
        .from('inventory_edit_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      
      if (error) {
        // Suppress warning if table is empty, doesn't exist yet, or schema cache is refreshing
        return 0;
      }
      return count || 0;
    } catch {
      return 0;
    }
  },
  async getEditRequests(): Promise<any[]> {
    if (!isSupabaseConfigured) return [];
    
    try {
      // Using a manual join approach since simple joins depend on FK structure and Supabase config
      // First, get the requests
      const { data: requests, error } = await supabase
        .from('inventory_edit_requests')
        .select('*')
        .order('requested_at', { ascending: false });
      
      if (error) {
        if (isFetchOrNetworkError(error)) disableSupabase();
        console.warn('getEditRequests error:', error);
        return [];
      }
      if (!requests || requests.length === 0) return [];

      // Get all relevant profiles and inventory items to "join" them manually
      const userIds = [...new Set([
        ...requests.map(r => r.requested_by),
        ...requests.map(r => r.reviewed_by).filter(Boolean)
      ])];
      
      const inventoryIds = [...new Set(requests.map(r => r.inventory_id).filter(Boolean))];

      const [profilesRes, inventoryRes] = await Promise.all([
        supabase.from('profiles').select('id, name').in('id', userIds),
        inventoryIds.length > 0 ? supabase.from('inventory').select('id, description').in('id', inventoryIds) : Promise.resolve({ data: [] })
      ]);

      const profilesMap = new Map((profilesRes.data || []).map(p => [p.id, p.name]));
      const inventoryMap = new Map((inventoryRes.data || []).map(i => [i.id, i.description]));

      return requests.map(r => ({
        ...r,
        requester_name: profilesMap.get(r.requested_by) || 'Desconhecido',
        reviewer_name: r.reviewed_by ? profilesMap.get(r.reviewed_by) : undefined,
        product_description: r.after_data?._isRecovery ? `RECUPERAÇÃO: ${r.after_data.description || 'Produto'}` : (inventoryMap.get(r.inventory_id) || 'Produto não encontrado')
      }));
    } catch (err) {
      if (isFetchOrNetworkError(err)) disableSupabase();
      console.warn('getEditRequests exception:', err);
      return [];
    }
  },

  async processEditRequest(requestId: string, adminId: string, status: 'approved' | 'rejected', adminComment?: string) {
    if (!isSupabaseConfigured) throw new Error('O Supabase não está configurado.');

    // 1. Get the request
    const { data: request, error: fetchError } = await supabase
      .from('inventory_edit_requests')
      .select('*')
      .eq('id', requestId)
      .single();
    
    if (fetchError) throw fetchError;

    // 2. If approved, apply changes to inventory
    if (status === 'approved') {
      const isRecovery = request.after_data._isRecovery;
      
      if (isRecovery) {
        // Find if slot is occupied
        let targetSlot = request.after_data.inspections?.[0]?.assignedSlot;
        let requiresAguardando = false;
        
        if (targetSlot && targetSlot !== 'AGUARDANDO') {
          const { data: slotData } = await supabase.from('warehouse_slots').select('status').eq('id', targetSlot).single();
          if (slotData && slotData.status !== 'VAZIO' && slotData.status !== request.after_data.inspections[0].contentType) {
             requiresAguardando = true;
          }
        }
        
        const payloadToInsert = {
          id: request.after_data.id,
          loading_id: request.after_data.loadingId,
          origin_op: request.after_data.originOP,
          description: request.after_data.description,
          lot: request.after_data.lot,
          pallets: request.after_data.pallets,
          status: request.after_data.status,
          date: request.after_data.date || new Date().toISOString(),
          inspections: request.after_data.inspections.map((i: any) => ({
            ...i,
            assignedSlot: requiresAguardando ? 'AGUARDANDO' : i.assignedSlot
          }))
        };

        const { error: insertError } = await supabase.from('inventory').insert(payloadToInsert);
        if (insertError && insertError.code !== '23505') throw insertError; // Ignore if somehow it exists already
        
        // If not AGUARDANDO, update the slot status
        if (!requiresAguardando && targetSlot && targetSlot !== 'AGUARDANDO') {
          await supabase.from('warehouse_slots').update({
             status: request.after_data.inspections[0].contentType,
             occupied_by: request.after_data.description
          }).eq('id', targetSlot);
        }

        // Add History entry for recovery
        const { data: adminProfile } = await supabase.from('profiles').select('name').eq('id', adminId).single();
        const adminName = adminProfile?.name || 'Administrador';
        
        const { data: operatorProfile } = await supabase.from('profiles').select('name').eq('id', request.requested_by).single();
        const operatorName = operatorProfile?.name || 'Operador';
        
        const recoveryContentType = request.after_data.inspections?.[0]?.contentType;
        const recoveryPalletType = request.after_data.is_group 
          ? 'CONSOLIDADO' 
          : (recoveryContentType ? translateSlotContent(recoveryContentType) : 'Produto Acabado');

        await supabase.from('history').insert({
          id: request.after_data.id + '-' + Math.random().toString(36).substring(2, 5),
          type: 'ENTRY', // Changed to ENTRY as it's recreating
          timestamp: new Date().toISOString(),
          loading_id: request.after_data.loadingId,
          description: request.after_data.description,
          op: request.after_data.originOP || '',
          lot: request.after_data.lot || '',
          pallet_number: 1,
          total_pallets: request.after_data.pallets,
          slot: requiresAguardando ? 'AGUARDANDO' : (targetSlot || 'AGUARDANDO'),
          details: `PALLET RECUPERADO. SOLICITADO POR: ${operatorName.toUpperCase()} APROVADO POR: ${adminName.toUpperCase()} - Motivo: ${request.reason}`,
          operator_name: adminName,
          pallet_type: recoveryPalletType
        });
      } else {
        // Handle potential slot changes
        const oldSlot = request.before_data.inspections?.[0]?.assignedSlot;
        const newSlot = request.after_data.inspections?.[0]?.assignedSlot;

        if (oldSlot !== newSlot) {
          // Free old slot if it was the only one
          if (oldSlot && oldSlot !== 'AGUARDANDO') {
            const { data: otherItemsInOldSlot } = await supabase
              .from('inventory')
              .select('id')
              .contains('inspections', [{ assignedSlot: oldSlot }])
              .neq('id', request.inventory_id);
              
            if (!otherItemsInOldSlot || otherItemsInOldSlot.length === 0) {
              await supabase.from('warehouse_slots').update({ status: 'VAZIO', occupied_by: null }).eq('id', oldSlot);
            }
          }

          // Occupy new slot if not aguardando
          if (newSlot && newSlot !== 'AGUARDANDO') {
            await supabase.from('warehouse_slots').update({ 
              status: request.after_data.inspections[0].contentType,
              occupied_by: request.after_data.description
            }).eq('id', newSlot);
          }
          
          // Add history for transfer if changed slot
          if (oldSlot && oldSlot !== 'AGUARDANDO' && newSlot && newSlot !== 'AGUARDANDO') {
            const transContentType = request.after_data.inspections?.[0]?.contentType;
            const transPalletType = request.after_data.is_group 
              ? 'CONSOLIDADO' 
              : (transContentType ? translateSlotContent(transContentType) : 'Produto Acabado');

            const { data: adminProfile } = await supabase.from('profiles').select('name').eq('id', adminId).single();
            await supabase.from('history').insert({
              id: request.after_data.id + '-TRANS-' + Math.random().toString(36).substring(2, 5),
              type: 'TRANSFER',
              timestamp: new Date().toISOString(),
              loading_id: request.after_data.loadingId,
              description: request.after_data.description,
              op: request.after_data.originOP || '',
              lot: request.after_data.lot || '',
              pallet_number: 1,
              total_pallets: request.after_data.pallets,
              slot: newSlot,
              details: `TRANSFERÊNCIA DA VAGA ${oldSlot} PARA ${newSlot}. Aprovado por: ${adminProfile?.name || 'Admin'} - Motivo: ${request.reason}`,
              operator_name: adminProfile?.name || 'Admin',
              pallet_type: transPalletType
            });
          }
        }

        const { error: updateError } = await supabase
          .from('inventory')
          .update({
            loading_id: request.after_data.loadingId,
            origin_op: request.after_data.originOP,
            description: request.after_data.description,
            lot: request.after_data.lot,
            pallets: request.after_data.pallets,
            status: request.after_data.status,
            inspections: request.after_data.inspections
          })
          .eq('id', request.inventory_id);
        
        if (updateError) throw updateError;
      }
    }

    // 3. Update the request status
    const { error: statusError } = await supabase
      .from('inventory_edit_requests')
      .update({
        status,
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
        admin_comment: adminComment
      })
      .eq('id', requestId);
    
    if (statusError) throw statusError;
    this.broadcastAppEvent('approval:resolved', { requestId, status, adminComment });
  },

  // Real-time Subscriptions
  subscribeToInventory(callback: (payload: any) => void) {
    if (!isSupabaseConfigured) return { unsubscribe: () => {} };
    return supabase
      .channel('inventory-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, callback)
      .subscribe();
  },

  subscribeToSlots(callback: (payload: any) => void) {
    if (!isSupabaseConfigured) return { unsubscribe: () => {} };
    return supabase
      .channel('slot-changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'warehouse_slots' }, callback)
      .subscribe();
  },

  // Shipments
  async getShipments(): Promise<Shipment[]> {
    const getLocalShipments = () => {
      return localStorageHelper.get('shipments');
    };

    if (!isSupabaseConfigured) return getLocalShipments();

    try {
      let { data, error } = await supabase
        .from('shipments')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error && isRetryableError(error)) {
        await new Promise(r => setTimeout(r, 400));
        const retryRes = await supabase
          .from('shipments')
          .select('*')
          .order('created_at', { ascending: false });
        data = retryRes.data;
        error = retryRes.error;
      }

      if (error) {
         if (isFetchOrNetworkError(error)) disableSupabase();
         console.warn('Supabase getShipments failed, falling back to local storage:', error);
         return getLocalShipments();
      }
      const shipments = (data || []).map(s => ({
        id: s.id,
        type: s.type as ShipmentType,
        status: s.status as ShipmentStatus,
        createdAt: s.created_at,
        scheduledDate: s.scheduled_date,
        operatorName: s.operator_name,
        closedAt: s.closed_at,
        obs: s.obs || s.notes || (localStorageHelper.get('shipments').find((ls: any) => ls.id === s.id)?.obs) || ''
      }));
      localStorageHelper.save('shipments', shipments);
      return shipments;
    } catch (err) {
      if (isFetchOrNetworkError(err)) disableSupabase();
      console.warn('getShipments exception, falling back to local storage:', err);
      return getLocalShipments();
    }
  },

  async saveShipment(shipment: Shipment) {
    if (isSupabaseConfigured) {
      try {
        // First attempt with obs
        const payload: any = {
          id: shipment.id,
          type: shipment.type,
          status: shipment.status,
          created_at: shipment.createdAt,
          scheduled_date: shipment.scheduledDate,
          operator_name: shipment.operatorName,
          closed_at: shipment.closedAt
        };
        if (shipment.obs !== undefined) {
          payload.obs = shipment.obs;
        }
        let { error } = await supabase
          .from('shipments')
          .upsert(payload);
        
        if (error) {
          console.warn('Supabase saveShipment with obs error, retrying without obs field:', error);
          // Fallback without obs if column doesn't exist in remote schema
          delete payload.obs;
          const retryRes = await supabase.from('shipments').upsert(payload);
          error = retryRes.error;
        }

        if (error && isFetchOrNetworkError(error)) {
          console.warn('Supabase saveShipment network error, saved locally:', error);
        }
      } catch (err) {
        if (isFetchOrNetworkError(err)) {
          console.warn('Supabase saveShipment exception, saved locally:', err);
        }
      }
    }
    localStorageHelper.update('shipments', shipment);
    this.broadcastAppEvent('shipment:saved', { shipment });
  },

  async deleteShipment(shipmentId: string) {
    try {
      if (isSupabaseConfigured) {
        // 1. Unlink all inventory items from this shipment
        const items = await this.getInventoryItemsByShipmentId(shipmentId);
        
        for (const item of items) {
          const updatedInspections = (item.inspections || []).map((insp: any) => {
            if (insp.shipmentId === shipmentId || insp.shipment_id === shipmentId) {
              const newInsp = { ...insp };
              delete newInsp.shipmentId;
              delete newInsp.shipment_id;
              return newInsp;
            }
            return insp;
          });

          await supabase
            .from('inventory')
            .update({ inspections: updatedInspections })
            .eq('id', item.id);
        }

        // 2. Delete the shipment record
        await supabase
          .from('shipments')
          .delete()
          .eq('id', shipmentId);
      }
    } catch (err) {
      console.warn('deleteShipment Supabase sync error, deleted locally:', err);
    }

    // Also delete locally
    const current = localStorageHelper.get('shipments');
    localStorageHelper.save('shipments', current.filter((s: any) => s.id !== shipmentId));
    this.broadcastAppEvent('shipment:deleted', { shipmentId });
  },

  async updateInventoryShipment(selections: { rowId: string, palletIdx: number }[], shipmentId: string | null) {
    try {
      if (isSupabaseConfigured) {
        // Group by rowId to minimize database calls
        const grouped = selections.reduce((acc, sel) => {
          if (!acc[sel.rowId]) acc[sel.rowId] = [];
          acc[sel.rowId].push(sel.palletIdx);
          return acc;
        }, {} as Record<string, number[]>);

        for (const rowId in grouped) {
          // 1. Get current item
          const { data: item, error: getError } = await supabase
            .from('inventory')
            .select('inspections')
            .eq('id', rowId)
            .single();
          
          if (getError) {
            console.warn('updateInventoryShipment fetch error:', getError);
            continue;
          }

          // 2. Update inspections array
          const inspections = [...(item.inspections || [])];
          grouped[rowId].forEach(idx => {
            if (inspections[idx]) {
              if (shipmentId === null) {
                const newInsp = { ...inspections[idx] };
                delete newInsp.shipmentId;
                delete (newInsp as any).shipment_id;
                inspections[idx] = newInsp;
              } else {
                inspections[idx] = { ...inspections[idx], shipmentId: shipmentId };
              }
            }
          });

          // 3. Save back
          await supabase
            .from('inventory')
            .update({ inspections })
            .eq('id', rowId);
        }
      }
    } catch (err) {
      console.warn('updateInventoryShipment exception:', err);
    }
  },

  async getShipmentPalletCounts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    const getLocalCounts = () => {
      const localCounts: Record<string, number> = {};
      const all = localStorageHelper.get('inventory');
      all.forEach((r: any) => r.inspections?.forEach((i: any) => {
        if (i.shipmentId) localCounts[i.shipmentId] = (localCounts[i.shipmentId] || 0) + 1;
      }));
      const hist = localStorageHelper.get('history');
      hist.forEach((h: any) => {
        if (h.details && h.details.includes('Finalização de Carregamento')) {
          const match = h.details.match(/Finalização de Carregamento (.+)/);
          if (match && match[1]) {
            localCounts[match[1]] = (localCounts[match[1]] || 0) + 1;
          }
        }
      });
      return localCounts;
    };

    if (!isSupabaseConfigured) return getLocalCounts();

    try {
      const { data: invData, error: invError } = await supabase
        .from('inventory')
        .select('inspections');
      
      if (invError) {
        if (isFetchOrNetworkError(invError)) disableSupabase();
        return getLocalCounts();
      }
      
      invData?.forEach(row => {
        row.inspections?.forEach((insp: any) => {
          const sId = insp.shipmentId || insp.shipment_id;
          if (sId) {
            counts[sId] = (counts[sId] || 0) + 1;
          }
        });
      });

      // Also count finalized ones from history
      const { data: histData, error: histError } = await supabase
        .from('history')
        .select('details')
        .like('details', '%Finalização de Carregamento%');

      if (!histError && histData) {
        histData.forEach(row => {
          if (row.details) {
            const match = row.details.match(/Finalização de Carregamento (.+)/);
            if (match && match[1]) {
              const sId = match[1];
              counts[sId] = (counts[sId] || 0) + 1;
            }
          }
        });
      }

      return counts;
    } catch (err) {
      if (isFetchOrNetworkError(err)) disableSupabase();
      console.warn('getShipmentPalletCounts exception:', err);
      return getLocalCounts();
    }
  },

  // Rotative Stock
  async getRotativeStock(): Promise<RotativeStockItem[]> {
    if (!isSupabaseConfigured) return localStorageHelper.get('rotative_stock');

    try {
      const { data, error } = await supabase
        .from('rotative_stock')
        .select('*')
        .order('updated_at', { ascending: false });
      
      if (error) {
         if (isFetchOrNetworkError(error)) disableSupabase();
         console.warn('Supabase getRotativeStock failed, falling back to local storage:', error);
         return localStorageHelper.get('rotative_stock');
      }
      const rotativeStock = (data || []).map(item => ({
        id: item.id,
        productName: item.product_name,
        quantity: item.quantity,
        slotId: item.slot_id,
        type: item.type || 'Frasco',
        updatedAt: item.updated_at
      }));
      localStorageHelper.save('rotative_stock', rotativeStock);
      return rotativeStock;
    } catch (err) {
      if (isFetchOrNetworkError(err)) disableSupabase();
      console.warn('getRotativeStock exception, falling back to local storage:', err);
      return localStorageHelper.get('rotative_stock');
    }
  },

  async saveRotativeStockItem(item: RotativeStockItem) {
    if (isSupabaseConfigured) {
      try {
        const { error } = await supabase
          .from('rotative_stock')
          .upsert({
            id: item.id,
            product_name: item.productName,
            quantity: item.quantity,
            slot_id: item.slotId,
            type: item.type,
            updated_at: new Date().toISOString()
          });
        
        if (error) console.warn('Supabase saveRotativeStockItem error:', error);
      } catch (err) {
        console.warn('saveRotativeStockItem exception:', err);
      }
    }
    localStorageHelper.update('rotative_stock', item);
    this.broadcastAppEvent('rotative:saved', { item });
  },

  async deleteRotativeStockItem(id: string) {
    if (isSupabaseConfigured) {
      try {
        await supabase
          .from('rotative_stock')
          .delete()
          .eq('id', id);
      } catch (err) {
        console.warn('deleteRotativeStockItem exception:', err);
      }
    }
    const current = localStorageHelper.get('rotative_stock');
    localStorageHelper.save('rotative_stock', current.filter((r: any) => r.id !== id));
    this.broadcastAppEvent('rotative:deleted', { id });
  },

  async freeSlot(slotId: string) {
    if (isSupabaseConfigured) {
      try {
        let { error } = await supabase
          .from('warehouse_slots')
          .update({
            status: 'EMPTY',
            occupied_by: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', slotId);
        
        if (error && isRetryableError(error)) {
          await new Promise(r => setTimeout(r, 400));
          const retryRes = await supabase
            .from('warehouse_slots')
            .update({
              status: 'EMPTY',
              occupied_by: null,
              updated_at: new Date().toISOString()
            })
            .eq('id', slotId);
          error = retryRes.error;
        }

        if (error) {
          console.warn('Error freeing slot on Supabase:', error);
        }
      } catch (err) {
        console.warn('freeSlot exception:', err);
      }
    }
    
    // Update local storage too
    const slots = localStorageHelper.get('warehouse_slots');
    const index = slots.findIndex((s: any) => s.id === slotId);
    let freedSlot = null;
    if (index !== -1) {
      slots[index].status = 'EMPTY';
      slots[index].occupiedBy = null;
      freedSlot = slots[index];
      localStorageHelper.save('warehouse_slots', slots);
    }
    this.broadcastAppEvent('slot:updated', { slot: freedSlot || { id: slotId, status: 'VAZIO', occupiedBy: null } });
  },

  async getWarehouseDiagnostic(): Promise<WarehouseDiagnostic> {
    if (!isSupabaseConfigured) {
      return {
        noDefinitiveSlot: 0,
        slotConflicts: 0,
        orphanedSlots: 0,
        freeSlotsWithPallets: 0,
        details: {
          noDefinitiveSlotItems: [],
          conflictSlots: [],
          orphanedSlotIds: [],
          freeSlotWithPalletIds: []
        }
      };
    }

    try {
      const [slotsRes, inventoryRes] = await Promise.all([
        supabase.from('warehouse_slots').select('id, status, occupied_by'),
        applyInventoryFilter(supabase.from('inventory').select('id, loading_id, inspections'), 'ROOT_ONLY').neq('status', 'PENDING')
      ]);

      const slots = slotsRes.data || [];
      const inventory = inventoryRes.data || [];

      const noDefinitiveSlotItems: string[] = [];
      const slotToPallets = new Map<string, { itemId: string, type: SlotContent }[]>();
      
      const placeholderValues = [null, '', 'AGUARDANDO', 'N/A', 'SEM VAGA'];

      inventory.forEach(item => {
        (item.inspections || []).forEach((insp: any) => {
          const slotId = insp.assignedSlot;
          if (placeholderValues.includes(slotId)) {
            noDefinitiveSlotItems.push(`${item.loading_id || item.id} (Palete ${insp.palletNumber || '?'})`);
          } else {
            const current = slotToPallets.get(slotId) || [];
            current.push({ 
              itemId: `${item.loading_id || item.id}`, 
              type: insp.contentType 
            });
            slotToPallets.set(slotId, current);
          }
        });
      });

      const conflictSlots: string[] = [];
      slotToPallets.forEach((pallets, slotId) => {
        if (pallets.length > 1) {
          // It's a conflict if ANY item in the slot is NOT shareable
          const hasNonShareable = pallets.some(p => !SHAREABLE_SLOT_TYPES.includes(p.type));
          if (hasNonShareable) {
            conflictSlots.push(slotId);
          }
        }
      });

      const orphanedSlotIds: string[] = [];
      const freeSlotWithPalletIds: string[] = [];

      slots.forEach(slot => {
        const hasPallet = slotToPallets.has(slot.id);
        const isOccupiedInDB = slot.status !== 'EMPTY';

        if (isOccupiedInDB && !hasPallet) {
          orphanedSlotIds.push(slot.id);
        } else if (!isOccupiedInDB && hasPallet) {
          freeSlotWithPalletIds.push(slot.id);
        }
      });

      return {
        noDefinitiveSlot: noDefinitiveSlotItems.length,
        slotConflicts: conflictSlots.length,
        orphanedSlots: orphanedSlotIds.length,
        freeSlotsWithPallets: freeSlotWithPalletIds.length,
        details: {
          noDefinitiveSlotItems,
          conflictSlots,
          orphanedSlotIds,
          freeSlotWithPalletIds
        }
      };
    } catch (error) {
      if (isFetchOrNetworkError(error)) disableSupabase();
      console.warn('Error getting warehouse diagnostic:', error);
      return {
        noDefinitiveSlot: 0,
        slotConflicts: 0,
        orphanedSlots: 0,
        freeSlotsWithPallets: 0,
        details: {
          noDefinitiveSlotItems: [],
          conflictSlots: [],
          orphanedSlotIds: [],
          freeSlotWithPalletIds: []
        }
      };
    }
  },

  async resyncSlots() {
    if (!isSupabaseConfigured) return { success: true, fixed: 0 };

    try {
      const diagnostic = await this.getWarehouseDiagnostic();
      let fixedCount = 0;

      // 1. Repair orphaned slots (Safe to release)
      if (diagnostic.details.orphanedSlotIds.length > 0) {
        const { error } = await supabase
          .from('warehouse_slots')
          .update({
            status: 'EMPTY',
            occupied_by: null,
            updated_at: new Date().toISOString()
          })
          .in('id', diagnostic.details.orphanedSlotIds);
        
        if (error) throw error;
        fixedCount += diagnostic.details.orphanedSlotIds.length;
      }

      // 2. Repair free slots that have pallets (Safe ONLY if no conflict)
      const safeToMarkOccupied = diagnostic.details.freeSlotWithPalletIds.filter(
        slotId => !diagnostic.details.conflictSlots.includes(slotId)
      );

      if (safeToMarkOccupied.length > 0) {
        // We need to fetch the inventory again to get the content type for these slots
        const inventory = await this.getAllInventoryForExport({ includeGrouped: true });
        
        for (const slotId of safeToMarkOccupied) {
          const itemWithSlot = inventory.find(item => 
            item.inspections?.some(insp => insp.assignedSlot === slotId)
          );
          
          if (itemWithSlot) {
            const inspection = itemWithSlot.inspections?.find(insp => insp.assignedSlot === slotId);
            const { error } = await supabase
              .from('warehouse_slots')
              .update({
                status: inspection?.contentType || 'OTHER',
                occupied_by: itemWithSlot.originOP || itemWithSlot.loadingId,
                updated_at: new Date().toISOString()
              })
              .eq('id', slotId);
            
            if (!error) fixedCount++;
          }
        }
      }

      return { success: true, fixed: fixedCount };
    } catch (error) {
      console.error('Error resyncing slots:', error);
      throw error;
    }
  },

  async cleanupGhostPallets() {
    if (!isSupabaseConfigured) return { success: true, removed: 0 };

    try {
      // Find all items with status NOT PENDING (as pending items don't have inspections yet)
      // and check if inspections is empty
      const { data, error } = await supabase.from('inventory').select('id, inspections').neq('status', 'PENDING').eq('is_group', false).is('parent_group_id', null);
      
      if (error) throw error;
      
      const ghostIds = (data || [])
        .filter(item => !item.inspections || (Array.isArray(item.inspections) && item.inspections.length === 0))
        .map(item => item.id);
      
      if (ghostIds.length === 0) return { success: true, removed: 0 };

      const { error: deleteError } = await supabase
        .from('inventory')
        .delete()
        .in('id', ghostIds);
      
      if (deleteError) throw deleteError;

      return { success: true, removed: ghostIds.length };
    } catch (error) {
      console.error('Error cleaning ghost pallets:', error);
      throw error;
    }
  },

  // Restaura um backup completo (JSON gerado pela própria exportação de backup) substituindo
  // TODOS os dados atuais de estoque, histórico, vagas, carregamentos e estoque rotativo.
  // Por segurança, NÃO mexe em "usuarios" (profiles), pois esses registros estão amarrados às
  // contas reais do Supabase Auth — restaurar essa tabela poderia travar logins. Também não
  // restaura "solicitacoesEdicao" (inventory_edit_requests), já que essas linhas referenciam
  // usuários e itens que podem não coincidir mais após a restauração.
  async restoreFullBackup(backup: any): Promise<{ success: boolean; summary: Record<string, number>; skipped: string[]; failed: Record<string, string>; warnings: Record<string, string> }> {
    if (!isSupabaseConfigured) {
      throw new Error('Restaurar backup requer conexão com o Supabase configurada.');
    }

    const dados = backup?.dados || backup;
    if (!dados || typeof dados !== 'object') {
      throw new Error('Arquivo de backup inválido: estrutura de dados não encontrada.');
    }

    const summary: Record<string, number> = {};
    // Tabelas que o arquivo dizia conter, mas vieram vazias (0 registros) — nunca apagamos dados
    // reais para "substituir" por nada. Ficam registradas aqui para avisar o usuário, e a tabela
    // correspondente no banco é deixada intacta.
    const skipped: string[] = [];
    // Tabelas em que a restauração foi tentada mas falhou no meio do caminho (ex.: erro de rede,
    // linha rejeitada pelo banco). Guardamos o erro por tabela em vez de abortar tudo, para que uma
    // falha isolada em uma tabela não impeça a restauração das demais.
    const failed: Record<string, string> = {};
    // Tabelas restauradas com sucesso, mas em que algum campo do backup teve que ser descartado
    // porque a coluna correspondente não existe de fato no banco (schema desatualizado).
    const warnings: Record<string, string> = {};

    const chunkArray = <T,>(arr: T[], size: number): T[][] => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };

    const replaceTable = async (table: string, rows: any[], label: string) => {
      // Proteção contra perda de dados: um backup com essa lista vazia (arquivo antigo, exportação
      // com falha, etc.) NUNCA deve apagar o que já existe no banco. Só apagamos e substituímos
      // quando o backup realmente traz pelo menos 1 registro para repor.
      if (rows.length === 0) {
        skipped.push(label);
        return;
      }

      try {
        const { error: delError } = await supabase.from(table).delete().neq('id', '__stoque_restore_none__');
        if (delError) throw new Error(`Falha ao limpar antes de restaurar: ${delError.message}`);

        // O schema real do banco pode ter ficado para trás do que o código espera (ex.: uma coluna
        // que só existe no comentário de criação da tabela, mas nunca foi de fato adicionada em
        // produção). O Postgrest recusa o insert inteiro nesse caso com uma mensagem do tipo
        // "Could not find the 'x' column of 'y' in the schema cache". Em vez de deixar a tabela já
        // apagada e travada nesse erro, detectamos a coluna que falta, removemos ela de TODAS as
        // linhas e tentamos de novo — perdendo só aquele campo específico, não os dados inteiros.
        const missingColumnPattern = /Could not find the '([^']+)' column/i;
        const droppedColumns: string[] = [];
        let workingRows = rows;
        // Reprocessa do zero sempre que uma coluna inexistente é descartada — como o insert que
        // falhou não grava nada, é seguro repetir com as linhas já corrigidas.
        let restartsLeft = 5;

        while (true) {
          const chunks = chunkArray(workingRows, 100);
          let inserted = 0;
          let missingColRetry = false;

          for (let i = 0; i < chunks.length; i++) {
            const part = chunks[i];
            if (part.length === 0) continue;

            const { error: insError } = await supabase.from(table).insert(part);
            if (insError) {
              const match = insError.message?.match(missingColumnPattern);
              if (match && !droppedColumns.includes(match[1]) && restartsLeft > 0) {
                const col = match[1];
                droppedColumns.push(col);
                restartsLeft--;
                workingRows = workingRows.map(r => {
                  const { [col]: _omit, ...rest } = r;
                  return rest;
                });
                missingColRetry = true;
                break;
              }

              const firstId = part[0]?.id;
              const lastId = part[part.length - 1]?.id;
              throw new Error(
                `${inserted} de ${rows.length} registros já haviam sido restaurados quando este lote (registros ${i * 100 + 1}–${i * 100 + part.length}, ids "${firstId}"…"${lastId}") falhou: ${insError.message}`
              );
            }
            inserted += part.length;
          }

          if (missingColRetry) continue;
          break;
        }

        summary[label] = rows.length;
        if (droppedColumns.length > 0) {
          warnings[label] = `Restaurado, mas o campo "${droppedColumns.join(', ')}" não existe na tabela do banco (o código esperava essa coluna, mas ela nunca foi criada nessa tabela) — os demais dados foram restaurados normalmente, só esse campo específico ficou de fora desses registros.`;
        }
      } catch (err: any) {
        failed[label] = err?.message || String(err);
      }
    };

    // Ordem importa pouco aqui pois inventory/warehouse_slots/history/shipments não têm FK
    // estrita entre si neste schema, mas mantemos vagas e estoque antes do histórico por clareza.
    if (Array.isArray(dados.vagas)) {
      await replaceTable('warehouse_slots', dados.vagas.map((s: any) => ({
        id: s.id,
        rack: s.rack,
        level: s.level,
        position: s.position,
        status: s.status,
        occupied_by: s.occupiedBy ?? null,
        updated_at: new Date().toISOString()
      })), 'vagas');
    } else {
      skipped.push('vagas');
    }

    if (Array.isArray(dados.inventario)) {
      await replaceTable('inventory', dados.inventario.map((item: any) => ({
        id: item.id,
        loading_id: item.loadingId,
        origin_op: item.originOP,
        description: item.description,
        lot: item.lot,
        pallets: item.pallets,
        date: item.date,
        status: item.status,
        inspections: item.inspections || [],
        operator_name: item.operatorName,
        is_group: item.is_group ?? false,
        parent_group_id: item.parent_group_id ?? null
      })), 'inventario');
    } else {
      skipped.push('inventario');
    }

    if (Array.isArray(dados.historico)) {
      await replaceTable('history', dados.historico.map((h: any) => ({
        id: h.id,
        type: h.type,
        timestamp: h.timestamp,
        loading_id: h.loadingId,
        description: h.description,
        op: h.op,
        lot: h.lot,
        pallet_number: h.palletNumber,
        total_pallets: h.totalPallets,
        slot: h.slot,
        details: h.details,
        operator_name: h.operatorName,
        pallet_type: h.palletType
      })), 'historico');
    } else {
      skipped.push('historico');
    }

    if (Array.isArray(dados.carregamentos)) {
      await replaceTable('shipments', dados.carregamentos.map((s: any) => ({
        id: s.id,
        type: s.type,
        status: s.status,
        created_at: s.createdAt,
        scheduled_date: s.scheduledDate,
        operator_name: s.operatorName,
        closed_at: s.closedAt,
        obs: s.obs ?? null
      })), 'carregamentos');
    } else {
      skipped.push('carregamentos');
    }

    if (Array.isArray(dados.estoqueRotativo)) {
      await replaceTable('rotative_stock', dados.estoqueRotativo.map((item: any) => ({
        id: item.id,
        product_name: item.productName,
        quantity: item.quantity,
        slot_id: item.slotId,
        type: item.type,
        updated_at: item.updatedAt || new Date().toISOString()
      })), 'estoqueRotativo');
    } else {
      skipped.push('estoqueRotativo');
    }

    this.broadcastAppEvent('backup:restored', { summary, skipped, failed, warnings });
    return { success: Object.keys(failed).length === 0, summary, skipped, failed, warnings };
  },

  subscribeToRotativeStock(callback: (payload: any) => void) {
    if (!isSupabaseConfigured) return { unsubscribe: () => {} };
    try {
      return supabase
        .channel('rotative-stock-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rotative_stock' }, callback)
        .subscribe();
    } catch (e) {
      console.warn('Realtime subscription failed for rotative stock:', e);
      return { unsubscribe: () => {} };
    }
  },

  
  subscribeToEditRequests(callback: (payload: any) => void) {
    if (!isSupabaseConfigured) return { unsubscribe: () => {} };
    try {
      return supabase
        .channel('edit-requests-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_edit_requests' }, callback)
        .subscribe();
    } catch (e) {
      console.warn('Realtime subscription failed for edit requests:', e);
      return { unsubscribe: () => {} };
    }
  },
  subscribeToShipments(callback: (payload: any) => void) {
    if (!isSupabaseConfigured) return { unsubscribe: () => {} };
    try {
      return supabase
        .channel('shipment-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'shipments' }, callback)
        .subscribe();
    } catch (e) {
      console.warn('Realtime subscription failed for shipments:', e);
      return { unsubscribe: () => {} };
    }
  },
  subscribeToHistory(callback: (payload: any) => void) {
    if (!isSupabaseConfigured) return { unsubscribe: () => {} };
    try {
      return supabase
        .channel('history-changes')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'history' }, callback)
        .subscribe();
    } catch (e) {
      console.warn('Realtime subscription failed for history:', e);
      return { unsubscribe: () => {} };
    }
  },

  // Instant Multi-User Realtime Broadcast & Presence Engine
  initSyncRoom(userInfo?: { id?: string; name: string; role: string; email?: string }) {
    if (!isSupabaseConfigured) return null;
    if (userInfo) currentPresenceUser = userInfo;

    if (!syncChannel) {
      syncChannel = supabase.channel('stoque-sync-room', {
        config: {
          broadcast: { self: false },
          presence: { key: clientSessionId }
        }
      });

      // Broadcast listener
      syncChannel.on('broadcast', { event: '*' }, (msg: any) => {
        if (msg && msg.event && msg.payload) {
          if (msg.payload._senderId !== clientSessionId) {
            syncBroadcastCallbacks.forEach(cb => {
              try { cb(msg.event, msg.payload); } catch (e) { console.warn(e); }
            });
          }
        }
      });

      const notifyPresence = () => {
        const state = syncChannel.presenceState();
        const users: any[] = [];
        Object.values(state).forEach((presences: any) => {
          if (Array.isArray(presences)) {
            presences.forEach(p => users.push(p));
          }
        });
        syncPresenceCallbacks.forEach(cb => {
          try { cb(users); } catch (e) { console.warn(e); }
        });
      };

      syncChannel.on('presence', { event: 'sync' }, notifyPresence);
      syncChannel.on('presence', { event: 'join' }, notifyPresence);
      syncChannel.on('presence', { event: 'leave' }, notifyPresence);

      syncChannel.subscribe(async (status: string, err: any) => {
        if (err) console.warn('Sync channel warning:', err);
        if (status === 'SUBSCRIBED' && currentPresenceUser) {
          try {
            await syncChannel.track({
              id: currentPresenceUser.id || clientSessionId,
              name: currentPresenceUser.name,
              role: currentPresenceUser.role,
              email: currentPresenceUser.email,
              sessionId: clientSessionId,
              onlineAt: new Date().toISOString()
            });
          } catch (e) {
            console.warn('channel.track error on subscribe:', e);
          }
        }
      });
    } else if (userInfo) {
      if (syncChannel.state === 'joined') {
        syncChannel.track({
          id: userInfo.id || clientSessionId,
          name: userInfo.name,
          role: userInfo.role,
          email: userInfo.email,
          sessionId: clientSessionId,
          onlineAt: new Date().toISOString()
        }).catch((e: any) => console.warn('Track update error:', e));
      }
    }

    return syncChannel;
  },

  getSyncChannel() {
    return this.initSyncRoom();
  },

  async broadcastAppEvent(event: string, payload: any) {
    if (!isSupabaseConfigured) return;
    try {
      const channel = this.initSyncRoom();
      if (channel) {
        await channel.send({
          type: 'broadcast',
          event,
          payload: {
            ...payload,
            _senderId: clientSessionId,
            _timestamp: Date.now()
          }
        });
      }
    } catch (e) {
      console.warn('broadcastAppEvent error:', e);
    }
  },

  subscribeToAppBroadcast(callback: (event: string, payload: any) => void) {
    if (!isSupabaseConfigured) return { unsubscribe: () => {} };
    syncBroadcastCallbacks.push(callback);
    this.initSyncRoom();
    return {
      unsubscribe: () => {
        syncBroadcastCallbacks = syncBroadcastCallbacks.filter(cb => cb !== callback);
      }
    };
  },

  trackPresence(userInfo: { id?: string; name: string; role: string; email?: string }, onPresenceSync?: (activeUsers: any[]) => void) {
    if (!isSupabaseConfigured) return { unsubscribe: () => {} };
    if (onPresenceSync) {
      syncPresenceCallbacks.push(onPresenceSync);
    }
    const channel = this.initSyncRoom(userInfo);

    return {
      unsubscribe: () => {
        if (onPresenceSync) {
          syncPresenceCallbacks = syncPresenceCallbacks.filter(cb => cb !== onPresenceSync);
        }
        try {
          if (channel) channel.untrack();
        } catch {}
      }
    };
  }
};

export function mapHistoryRow(entry: any): HistoryEntry {
  const rawType = entry.pallet_type || entry.palletType;
  let normalizedType = rawType;
  if (rawType && typeof rawType === 'string' && rawType.trim() !== '' && rawType.trim() !== '-') {
    const trimmed = rawType.trim();
    if (trimmed.toUpperCase() === 'CONSOLIDADO') {
      normalizedType = 'CONSOLIDADO';
    } else {
      normalizedType = translateSlotContent(parseSlotContent(trimmed));
    }
  }

  return {
    id: entry.id,
    type: entry.type as HistoryType,
    timestamp: entry.timestamp,
    loadingId: entry.loading_id,
    description: entry.description,
    op: entry.op,
    lot: entry.lot,
    palletNumber: entry.pallet_number,
    totalPallets: entry.total_pallets,
    slot: entry.slot,
    details: entry.details,
    operatorName: entry.operator_name,
    palletType: normalizedType
  };
}

