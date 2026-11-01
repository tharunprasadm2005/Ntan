import { formatDate, formatQty, humanize } from './format';
import type { Balance, Client, Item, Location, Receipt, Warehouse } from './types';

function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export interface WarehouseAssistantContext {
  items: Item[];
  balances: Balance[];
  receipts: Receipt[];
  warehouses: Warehouse[];
  locations: Location[];
  clients: Client[];
  activeClient?: Client | null;
}

export function processWarehouseAssistantQuery(
  rawQuery: string,
  context: WarehouseAssistantContext,
): string {
  const query = rawQuery.trim();
  const lower = query.toLowerCase();
  const {
    items = [],
    balances = [],
    receipts = [],
    warehouses = [],
    locations = [],
    clients = [],
    activeClient,
  } = context;

  // 1. Calculate Live Aggregations
  let totalOnHand = 0;
  let totalAvailable = 0;
  let totalReserved = 0;
  let totalValuation = 0;

  for (const b of balances) {
    const onHand = Number(b.on_hand ?? 0);
    const avail = Number(b.available ?? 0);
    const res = Number(b.reserved ?? 0);
    totalOnHand += onHand;
    totalAvailable += avail;
    totalReserved += res;

    const item = items.find((i) => i.id === b.item_id);
    const unitCost = Number(item?.cost ?? 12.5);
    totalValuation += onHand * unitCost;
  }

  const stockoutItems = items.filter((item) => {
    const totalItemBal = balances
      .filter((b) => b.item_id === item.id)
      .reduce((sum, b) => sum + Number(b.on_hand ?? 0), 0);
    return totalItemBal === 0;
  });

  const stockedItems = items.filter((item) => {
    const totalItemBal = balances
      .filter((b) => b.item_id === item.id)
      .reduce((sum, b) => sum + Number(b.on_hand ?? 0), 0);
    return totalItemBal > 0;
  });

  // 2. Exact or High-Relevance SKU / Product Matching
  // Check if query mentions an SKU or significant item name part
  const matchedItem = items.find((item) => {
    const skuLower = item.sku.toLowerCase();
    const barcodeLower = (item.barcode ?? '').toLowerCase();
    const nameLower = item.name.toLowerCase();

    if (lower.includes(skuLower)) return true;
    if (barcodeLower && lower.includes(barcodeLower)) return true;

    // Check words in item name (length >= 4 to avoid tiny collisions)
    const nameWords = nameLower.split(/\s+/).filter((w) => w.length >= 4);
    return nameWords.some((w) => lower.includes(w));
  });

  if (matchedItem) {
    const itemBalances = balances.filter((b) => b.item_id === matchedItem.id);
    const itemOnHand = itemBalances.reduce((sum, b) => sum + Number(b.on_hand ?? 0), 0);
    const itemAvailable = itemBalances.reduce((sum, b) => sum + Number(b.available ?? 0), 0);
    const itemReserved = itemBalances.reduce((sum, b) => sum + Number(b.reserved ?? 0), 0);

    const locationsWithStock = itemBalances
      .filter((b) => Number(b.on_hand ?? 0) > 0)
      .map((b) => {
        const loc = locations.find((l) => l.id === b.location_id);
        const code = loc?.code || 'Bin';
        const qty = formatQty(String(b.on_hand));
        return `${code} (${qty} ${matchedItem.base_uom})`;
      });

    const prefLocations = (matchedItem.preferred_locations ?? [])
      .map((pl) => {
        const loc = locations.find((l) => l.id === pl.location_id);
        return loc ? `${loc.code} [${loc.path || loc.code}]` : null;
      })
      .filter(Boolean);

    return `📦 Product Information: **${matchedItem.sku}**
• Name: ${matchedItem.name}
• Total On Hand: ${formatNumber(itemOnHand)} ${matchedItem.base_uom}
• Available for Outbound: ${formatNumber(itemAvailable)} ${matchedItem.base_uom}
• Reserved / Allocated: ${formatNumber(itemReserved)} ${matchedItem.base_uom}
• Stored In: ${locationsWithStock.length ? locationsWithStock.join(', ') : 'No stock on hand (0 balance)'}
• Preferred Storage Bin: ${prefLocations.join(', ') || 'Not configured'}
• Tracking Mode: ${humanize(matchedItem.tracking_mode)}${matchedItem.expiry_tracked ? ' · Expiry Tracked' : ''}
• Unit Cost: $${matchedItem.cost ?? '0.00'}
• Status: ${humanize(matchedItem.status)}`;
  }

  // 3. Location / Bin Query
  const matchedLocation = locations.find((loc) => {
    const codeLower = loc.code.toLowerCase();
    return lower.includes(codeLower);
  });

  if (matchedLocation && (lower.includes('bin') || lower.includes('location') || lower.includes('rack') || lower.includes('shelf') || lower.includes('where'))) {
    const locBalances = balances.filter((b) => b.location_id === matchedLocation.id && Number(b.on_hand ?? 0) > 0);
    const storedItems = locBalances.map((b) => {
      const it = items.find((i) => i.id === b.item_id);
      return `${it?.sku || 'Item'}: ${formatQty(String(b.on_hand))} ${it?.base_uom || 'units'}`;
    });

    const wh = warehouses.find((w) => w.id === matchedLocation.warehouse_id);

    return `📍 Location Details: **${matchedLocation.code}**
• Facility: ${wh?.name || 'Warehouse'} (${wh?.code || 'WH'})
• Storage Type: ${humanize(matchedLocation.type)}
• Physical Path: ${matchedLocation.path || matchedLocation.code}
• Current Contents: ${storedItems.length ? storedItems.join(', ') : 'Empty (0 units on hand)'}
• Operational Status: ${humanize(matchedLocation.status)}`;
  }

  // 4. Greetings & General Help
  if (
    lower === 'hi' ||
    lower === 'hello' ||
    lower === 'hey' ||
    lower === 'help' ||
    lower.includes('who are you') ||
    lower.includes('what can you do') ||
    lower.includes('what do you do')
  ) {
    const primaryWh = warehouses[0]?.name || 'Warehouse';
    return `👋 Hello! I am your **NTAN Warehouse AI Assistant**, connected live to your inventory ledger.

Currently managing **${primaryWh}**:
• **${items.length} SKUs** in catalogue (${stockedItems.length} in stock, ${stockoutItems.length} zero-balance)
• **${formatNumber(totalOnHand)} physical units** on hand
• **${warehouses.length} facility** with **${locations.length} storage locations/bins**

You can ask me anything, such as:
1. *"What is the stock of CHG-1001?"*
2. *"Which items are out of stock?"*
3. *"What is our total inventory valuation?"*
4. *"Who are our registered suppliers?"*
5. *"How do I receive stock or complete putaway?"*`;
  }

  // 5. Stockouts, Low Stock & Zero Balances
  if (
    lower.includes('stockout') ||
    lower.includes('out of stock') ||
    lower.includes('zero balance') ||
    lower.includes('zero stock') ||
    lower.includes('low stock') ||
    lower.includes('reorder')
  ) {
    const sampleSkus = stockoutItems.slice(0, 6).map((i) => i.sku);
    return `⚠️ Stock Health Analysis:
• **${stockoutItems.length} of ${items.length} SKUs** currently have zero on-hand balance.
• Sample Zero-Stock Items: ${sampleSkus.join(', ') || 'None'}.
• Stocked SKUs: ${stockedItems.length} items have positive balances.

💡 *Next Step:* Navigate to **Replenishment & Reorder** to review reorder points and automatically generate purchase orders for depleted items.`;
  }

  // 6. Total Valuation, Quantity & Assets
  if (
    lower.includes('valuation') ||
    lower.includes('worth') ||
    lower.includes('value') ||
    lower.includes('total units') ||
    lower.includes('how many units') ||
    lower.includes('how much stock')
  ) {
    return `💰 Live Facility Valuation & Stock Overview:
• Total Physical On Hand: **${formatNumber(totalOnHand)} units**
• Available for Picking/Dispatch: **${formatNumber(totalAvailable)} units**
• Reserved for Orders: **${formatNumber(totalReserved)} units**
• Estimated Inventory Valuation: **$${formatNumber(totalValuation)}**
• Active Catalogue: **${items.length} SKUs** across **${warehouses.length} warehouse(s)**.`;
  }

  // 7. Receipts & Deliveries History
  if (
    lower.includes('receipt') ||
    lower.includes('delivery') ||
    lower.includes('deliveries') ||
    lower.includes('inbound') ||
    lower.includes('shipment')
  ) {
    const recent = [...receipts]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 4);

    if (recent.length === 0) {
      return `📥 No inbound receipts have been posted yet. You can scan or draft your first inbound delivery in **Operations > Receive Stock**.`;
    }

    const linesFormatted = recent.map((r) => {
      const lineSummary = r.lines?.map((l) => `${formatQty(l.base_qty)} ${l.base_uom} of ${l.sku}`).join(', ') || '0 lines';
      return `• **${r.number}** (${humanize(r.status)}): ${lineSummary} from ${r.supplier || 'Vendor'} on ${formatDate(r.created_at)}`;
    });

    return `📥 Goods Receipts Summary (${receipts.length} total receipts recorded):
${linesFormatted.join('\n')}

💡 *Action:* Tap **Operations > Receive Stock** to log new supplier deliveries, or tap any receipt to review discrepancy notes and putaway tasks.`;
  }

  // 8. How to Receive Stock / Receiving SOP
  if (
    lower.includes('how to receive') ||
    lower.includes('receive stock') ||
    lower.includes('receiving workflow') ||
    lower.includes('scanner') ||
    lower.includes('receive delivery')
  ) {
    return `📦 Receive Stock Workflow Guide:
1. Open **Operations > Receive Stock** and tap **Open scanner** (or enter barcode/SKU manually).
2. For ordinary items, scan repeatedly or enter quantity. For serial items, scan individual serial numbers; for lot items, enter lot/batch number and expiry.
3. Link the supplier and optional Purchase Order reference.
4. Tap **Review & Post delivery** and confirm.
5. Once committed, the inventory ledger updates immediately and staging generates a task in **Putaway Queue**.`;
  }

  // 9. Putaway Queue & Staging
  if (
    lower.includes('putaway') ||
    lower.includes('put away') ||
    lower.includes('staging') ||
    lower.includes('staged')
  ) {
    return `🚀 Putaway Queue Guide:
• **Purpose:** Move received stock from receiving docks (e.g. \`RECV\`) into permanent warehouse racks and picking bins.
• **Workflow:**
  1. Open **Operations > Putaway Queue**.
  2. Select an active task for a received item line.
  3. Scan or select the destination storage bin (suggested according to preferred bin assignment).
  4. Enter quantity placed and confirm putaway.
• Once putaway completes, stock transitions from staged to standard storage locations for picking.`;
  }

  // 10. Quality & Inspection / Quarantine
  if (
    lower.includes('quality') ||
    lower.includes('inspection') ||
    lower.includes('quarantine') ||
    lower.includes('damaged') ||
    lower.includes('defect') ||
    lower.includes('qc')
  ) {
    return `🛡️ Quality & Inspection Guide:
• Open **Operations > Quality & Inspection** to inspect inbound deliveries before final putaway.
• Inspect across 7 standard categories:
  1. **Product Identity** (SKU, barcode, model)
  2. **Physical Quantity** (unit counts, shortages)
  3. **Packaging** (seals, moisture, carton integrity)
  4. **Product Condition** (scratches, dents, cracks)
  5. **Functional Verification** (power test, performance)
  6. **Traceability** (batch/lot, serials, expiry date)
  7. **Compliance** (labels, safety certificates)
• **Results:**
  - **Passed:** Released to Putaway Queue for normal storage.
  - **Rejected / On-Hold:** Routed to Quarantine area, blocked from outbound dispatch until cleared.`;
  }

  // 11. Suppliers & Business Partners
  if (
    lower.includes('supplier') ||
    lower.includes('vendor') ||
    lower.includes('partner') ||
    lower.includes('customer') ||
    lower.includes('3pl')
  ) {
    const suppliers = clients.filter((c) => !c.is_internal && c.types?.includes('supplier'));
    const customers = clients.filter((c) => !c.is_internal && c.types?.includes('customer'));

    return `🤝 Business Partners Directory (${clients.length} registered partners):
• **Suppliers (${suppliers.length}):** ${suppliers.map((s) => `${s.name} (${s.code})`).join(', ') || 'None registered'}
• **Customers (${customers.length}):** ${customers.map((c) => `${c.name} (${c.code})`).join(', ') || 'None registered'}

💡 *Action:* Navigate to **More > Business Partners** to create suppliers, manage vendor SKU mappings, or upload partner spreadsheets in bulk.`;
  }

  // 12. Warehouses & Bins
  if (
    lower.includes('warehouse') ||
    lower.includes('facility') ||
    lower.includes('bin') ||
    lower.includes('rack') ||
    lower.includes('shelf') ||
    lower.includes('aisle')
  ) {
    const whSummary = warehouses.map((w) => {
      const locsCount = locations.filter((l) => l.warehouse_id === w.id).length;
      return `• **${w.name}** (${w.code}) — ${locsCount} locations configured. Address: ${w.address || 'Standard facility'}`;
    });

    return `🏢 Warehouse & Bins Overview:
${whSummary.join('\n')}
• Total Registered Locations: **${locations.length} bins/zones** across all warehouses.
• Storage Types Configured: Receiving docks, staging bays, forward picking bins, and bulk pallet storage.

💡 *Action:* View the full layout in **More > Warehouses & Bins**.`;
  }

  // 13. Bulk Import & Excel Templates
  if (
    lower.includes('bulk import') ||
    lower.includes('excel') ||
    lower.includes('csv') ||
    lower.includes('import') ||
    lower.includes('spreadsheet') ||
    lower.includes('template')
  ) {
    return `📊 Bulk Excel & CSV Import Guide:
NTAN supports spreadsheet bulk imports for:
1. **Item Catalogue:** \`SKU\`, \`Product\`, \`Warehouse\`, \`Zone\`, \`Aisle\`, \`Rack\`, \`Shelf\`, \`Bin\`, \`Storage Type\`, \`Cost\`, \`Price\`, \`Base UOM\`.
2. **Team & Access:** \`Name\`, \`Email\`, \`Role\`, \`Warehouse\`, \`Phone\`.
3. **Business Partners:** \`Code\`, \`Name\`, \`Role\` (supplier/customer), \`Phone\`, \`Email\`.

💡 *Tip:* Warehouse and Bin values in the spreadsheet must match existing active facilities in **Warehouses & Bins**. Duplicate SKUs will automatically update existing records (Upsert mode).`;
  }

  // 14. Stock Transfers & Outbound
  if (
    lower.includes('transfer') ||
    lower.includes('bulk transfer') ||
    lower.includes('move') ||
    lower.includes('outbound') ||
    lower.includes('pick') ||
    lower.includes('dispatch')
  ) {
    return `🔄 Stock Transfers & Outbound Operations:
• **Stock Transfers:** Move items between bins or warehouses via **Operations > Stock Transfers**.
  - Tap "Transfer All in Bin" to move an entire shelf pallet in one click.
  - Or scan individual item barcodes into the transfer draft.
• **Outbound Picking:** Create customer sales orders under **Operations > Outbound Waves** to generate directed pick lists and packing dockets.`;
  }

  // 15. Picking Rules (FIFO vs FEFO)
  if (
    lower.includes('fifo') ||
    lower.includes('fefo') ||
    lower.includes('picking rule') ||
    lower.includes('expiry rule')
  ) {
    return `⚖️ Warehouse Picking Rules:
• **FIFO (First-In, First-Out):** Directs pickers to stock that was received earliest. Best for standard non-perishable parts.
• **FEFO (First-Expired, First-Out):** Automatically routes pickers to the bin with the earliest batch expiration date. Essential for food, chemicals, and pharmaceuticals.
• Configure your rule under **More > Warehouse Rules**.`;
  }

  // 16. Support & Contact
  if (
    lower.includes('support') ||
    lower.includes('contact') ||
    lower.includes('email') ||
    lower.includes('phone') ||
    lower.includes('help desk')
  ) {
    return `📞 NTAN Support & Assistance:
• **Support Email:** ntanservices@gmail.com
• **Phone & WhatsApp:** +91 97627 29537
• **Hours:** 24/7 Warehouse Support
• Access contact channels directly from **More > Customer Care & Help Center**.`;
  }

  // 17. Intelligent Contextual Fallback
  return `🤖 NTAN Warehouse Intelligence Summary:
• Current Facility: **${warehouses[0]?.name || 'Coimbatore Warehouse'}** (${activeClient ? activeClient.name : 'Internal'})
• Active Catalogue: **${items.length} SKUs** (${stockedItems.length} in stock, ${stockoutItems.length} zero-balance)
• Total Units On Hand: **${formatNumber(totalOnHand)} units** ($${formatNumber(totalValuation)} estimated valuation)
• Storage Locations: **${locations.length} bins**

I couldn't find an exact match for *"${query}"*. Try asking:
• *"Check stock of [SKU or Item Name]"*
• *"List zero balance stockouts"*
• *"How do I receive stock or complete putaway?"*
• *"Show warehouses and bin locations"*
• *"Show recent delivery receipts"*`;
}
