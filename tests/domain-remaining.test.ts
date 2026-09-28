import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAction, DomainError } from '../server/domain.js';
import { createSeedState } from '../server/seed.js';
import { availableCredit, creditNoteAvailable, invoiceOutstanding } from '../shared/finance.js';
import type { AppState, Role, User } from '../shared/types.js';

let n = 0;
const now = '2026-09-28T12:00:00.000Z';
function act(s: AppState, type: string, payload: Record<string, unknown>, role: Role = 'admin', branches = ['b-delhi','b-faridabad']) {
 const user: User = { id: `u-${role}`, name: role, email: `${role}@demo.invalid`, role, branchIds: branches, orgId: 'batra', active: true };
 return applyAction(s, {type,payload,idempotencyKey:`remaining-${++n}`,expectedRevision:s.revision}, {user,now,id:()=>`remaining-id-${++n}`}).state;
}
const denies = (f:()=>unknown, re:RegExp) => assert.throws(f,(e:unknown)=>e instanceof DomainError && re.test(e.message));
const seed = () => createSeedState(now);

test('admin can stop offsite rent only at explicit unbilled date',()=>{
 let s=seed(); const c=s.cylinders.find(x=>x.id==='c-001')!;
 s=act(s,'cylinder.offsiteIncident',{cylinderId:c.id,version:c.version,kind:'lost',notes:'Missing'});
 const v=s.cylinders.find(x=>x.id===c.id)!.version;
 denies(()=>act(s,'rental.stopIncident',{cylinderId:c.id,version:v,stopDate:'2026-09-29',reason:'Approved'}),/future|today/i);
 denies(()=>act(s,'rental.stopIncident',{cylinderId:c.id,version:v,stopDate:'2020-01-01',reason:'Approved'}),/start/i);
 denies(()=>act(s,'rental.stopIncident',{cylinderId:c.id,version:v,stopDate:'2026-09-28',reason:'Approved'},'operations'),/permitted/i);
 s=act(s,'rental.stopIncident',{cylinderId:c.id,version:v,stopDate:'2026-09-28',reason:'Approved'});
 assert.equal(s.rentals.find(x=>x.cylinderId===c.id)?.end,'2026-09-28');
 assert.equal(s.cylinders.find(x=>x.id===c.id)?.custody,'customer');
});

test('lost stock writeoff retains custody and closes exception with third party approval',()=>{
 let s=seed(); const c=s.cylinders.find(x=>x.id==='c-001')!; c.ownerId='p-home-1';
 s=act(s,'cylinder.offsiteIncident',{cylinderId:c.id,version:c.version,kind:'lost',notes:'Lost'});
 const v=s.cylinders.find(x=>x.id===c.id)!.version;
 denies(()=>act(s,'cylinder.writeoff',{cylinderId:c.id,version:v,stopDate:'2026-09-28',reason:'Approved loss'}),/owner authorization/i);
 s=act(s,'cylinder.writeoff',{cylinderId:c.id,version:v,stopDate:'2026-09-28',reason:'Approved loss',ownerAuthorizationRef:'OWN-1'});
 const result=s.cylinders.find(x=>x.id===c.id)!;
 assert.equal(result.condition,'retired'); assert.equal(result.custody,'customer');
 assert.equal(s.exceptions.find(x=>x.entityId===c.id&&x.type==='offsite_lost')?.status,'resolved');
});

test('cross branch return requires receiving access and transfers plant branch',()=>{
 let s=seed();
 denies(()=>act(s,'cylinder.return',{partyId:'p-hospital-1',cylinderIds:['c-001'],contents:'empty',receivingBranchId:'b-faridabad',notes:'Other desk'},'operations',['b-delhi']),/Branch not found/i);
 s=act(s,'cylinder.return',{partyId:'p-hospital-1',cylinderIds:['c-001'],contents:'empty',receivingBranchId:'b-faridabad',notes:'Other desk'},'operations');
 const c=s.cylinders.find(x=>x.id==='c-001')!;
 assert.equal(c.branchId,'b-faridabad'); assert.equal(c.custodianId,'b-faridabad');
 assert.equal(s.rentals.find(x=>x.cylinderId===c.id)?.end,'2026-09-28');
});

test('cross branch return keeps third party owner stock in its owning branch',()=>{
 const s=seed(); const c=s.cylinders.find(x=>x.id==='c-001')!; c.ownerId='p-hospital-1';
 denies(()=>act(s,'cylinder.return',{partyId:'p-hospital-1',cylinderIds:[c.id],contents:'empty',receivingBranchId:'b-faridabad',notes:'Other desk'},'operations'),/owning branch/i);
});

test('pickup reversal restores customer custody only before receiving at plant',()=>{
 let s=seed(); s=act(s,'cylinder.collect',{partyId:'p-hospital-1',cylinderIds:['c-001'],vehicle:'V',driverId:'u-driver',notes:''},'operations');
 const pickup=s.pickups!.at(-1)!;
 s=act(s,'collection.reverse',{pickupId:pickup.id,cylinderIds:['c-001'],reason:'Pickup cancelled'},'operations');
 assert.equal(s.cylinders.find(x=>x.id==='c-001')?.custody,'customer');
 assert.equal(s.rentals.find(x=>x.cylinderId==='c-001')?.end,undefined);
 denies(()=>act(s,'collection.reverse',{pickupId:pickup.id,cylinderIds:['c-001'],reason:'Again'}),/vehicle|pickup/i);
});

test('paid invoice credit becomes allocatable balance and preserves original payment',()=>{
 let s=seed(); const i=s.invoices.find(x=>x.type==='gas'&&x.status!=='credited')!;
 i.paidPaise=i.totalPaise; i.status='paid';
 s=act(s,'finance.credit',{invoiceId:i.id,amountPaise:Math.min(1000,i.totalPaise),reason:'Price adjustment'},'finance');
 const note=s.invoices.at(-1)!; assert.equal(availableCredit(s,i.partyId),note.totalPaise);
 assert.equal(creditNoteAvailable(s,note.id),note.totalPaise);
 assert.equal(s.invoices.find(x=>x.id===i.id)?.paidPaise,i.totalPaise);
 assert.equal(invoiceOutstanding(s.invoices.find(x=>x.id===i.id)!),0);
});

test('unpaid invoice credit reduces debt without cash credit',()=>{
 let s=seed(); const i=s.invoices.find(x=>x.type==='gas'&&x.status==='issued')!;
 s=act(s,'finance.credit',{invoiceId:i.id,amountPaise:Math.min(1000,i.totalPaise),reason:'Adjustment'},'finance');
 assert.equal(availableCredit(s,i.partyId),0);
 assert.equal(invoiceOutstanding(s.invoices.find(x=>x.id===i.id)!),i.totalPaise-Math.min(1000,i.totalPaise));
});

test('held cylinders block deposit refund without admin reason',()=>{
 let s=seed(); const party=s.parties.find(x=>x.id==='p-hospital-1')!;
 s=act(s,'finance.deposit',{partyId:party.id,amountPaise:1000,method:'bank',reference:'DEP-X'},'finance');
 denies(()=>act(s,'finance.refund',{partyId:party.id,amountPaise:1000,method:'bank',reference:'REF-X',reason:'Requested'},'finance'),/held|outstanding/i);
 s=act(s,'finance.refund',{partyId:party.id,amountPaise:1000,method:'bank',reference:'REF-X',reason:'Requested',overrideReason:'Management exception'});
 assert.equal(s.receipts.at(-1)?.kind,'refund');
});

test('credit allocation and refund cannot reuse the same credit balance',()=>{
 let s=seed(); const paid=s.invoices.find(x=>x.type==='gas'&&x.status!=='credited')!;
 paid.paidPaise=paid.totalPaise; paid.status='paid';
 const amount=Math.min(2000,paid.totalPaise);
 s=act(s,'finance.credit',{invoiceId:paid.id,amountPaise:amount,reason:'Correct price'},'finance');
 const note=s.invoices.at(-1)!;
 const target=structuredClone(paid); target.id='target-credit-test'; target.number='GINV-TEST'; target.paidPaise=0; target.status='issued';
 s.invoices.push(target);
 {
   s=act(s,'finance.creditAllocate',{creditInvoiceId:note.id,invoiceId:target.id,amountPaise:Math.min(500,amount),reason:'Apply customer credit'},'finance');
   assert.equal(s.receipts.at(-1)?.kind,'credit_allocation');
   assert.equal(s.receipts.at(-1)?.creditInvoiceId,note.id);
   assert.equal(creditNoteAvailable(s,note.id),amount-Math.min(500,amount));
 }
 const remaining=creditNoteAvailable(s,note.id);
 if (remaining>0) {
   s=act(s,'finance.creditRefund',{partyId:paid.partyId,creditInvoiceId:note.id,amountPaise:remaining,method:'bank',reference:'CREF-X',reason:'Customer request'},'finance');
   assert.equal(availableCredit(s,paid.partyId),0);
   denies(()=>act(s,'finance.creditRefund',{partyId:paid.partyId,creditInvoiceId:note.id,amountPaise:1,method:'bank',reference:'CREF-Y',reason:'Again'},'finance'),/available/i);
 }
});

test('allocated customer credit must be unallocated before correcting its target invoice',()=>{
 let s=seed(); const source=s.invoices.find(x=>x.type==='gas'&&x.status==='issued')!;
 source.paidPaise=source.totalPaise; source.status='paid';
 const target=structuredClone(source); target.id='target-unallocation'; target.number='GINV-TEST-2'; target.paidPaise=0; target.status='issued'; s.invoices.push(target);
 s=act(s,'finance.credit',{invoiceId:source.id,amountPaise:1000,reason:'First correction'},'finance');
 const note=s.invoices.at(-1)!;
 s=act(s,'finance.creditAllocate',{creditInvoiceId:note.id,invoiceId:target.id,amountPaise:1000,reason:'Apply'},'finance');
 const allocation=s.receipts.at(-1)!;
 assert.equal(availableCredit(s,source.partyId),0);
 denies(()=>act(s,'finance.credit',{invoiceId:target.id,amountPaise:1000,reason:'Second correction'},'finance'),/Reverse allocated/i);
 s=act(s,'finance.creditUnallocate',{receiptId:allocation.id,reason:'Correct target'},'finance');
 assert.equal(s.receipts.find(x=>x.id===allocation.id)?.reversalReason,'Correct target');
 assert.equal(availableCredit(s,source.partyId),1000);
 denies(()=>act(s,'finance.creditUnallocate',{receiptId:allocation.id,reason:'Again'},'finance'),/already reversed/i);
 s=act(s,'finance.credit',{invoiceId:target.id,amountPaise:1000,reason:'Second correction'},'finance');
 assert.equal(availableCredit(s,source.partyId),1000);
});

test('partial credits preserve original tax exactly when fully corrected',()=>{
 let s=seed(); const original=s.invoices.find(x=>x.type==='gas'&&x.status==='issued')!;
 const first=Math.floor(original.totalPaise/3);
 s=act(s,'finance.credit',{invoiceId:original.id,amountPaise:first,reason:'Part one'},'finance');
 const a=s.invoices.at(-1)!;
 s=act(s,'finance.credit',{invoiceId:original.id,amountPaise:original.totalPaise-first,reason:'Part two'},'finance');
 const b=s.invoices.at(-1)!;
 assert.equal(a.totalPaise+b.totalPaise,original.totalPaise);
 assert.equal(a.taxPaise+b.taxPaise,original.taxPaise);
 assert.equal(a.subtotalPaise+b.subtotalPaise,original.subtotalPaise);
 assert.equal(s.invoices.find(x=>x.id===original.id)?.status,'credited');
});

test('credit limit requires a recorded administrator override when exceeded',()=>{
 let s=seed(); const o=s.orders.find(x=>x.id==='o-partial-1')!;
 s=act(s,'order.unload',{orderId:o.id,cylinderIds:['c-004'],notes:'Route complete'},'operations');
 s.parties.find(x=>x.id===o.partyId)!.creditLimitPaise=1;
 denies(()=>act(s,'finance.invoice',{orderId:o.id,taxBps:0,dueDate:'2026-09-28',notes:''},'finance'),/credit limit/i);
 denies(()=>act(s,'finance.invoice',{orderId:o.id,taxBps:0,dueDate:'2026-09-28',notes:'',creditLimitOverrideReason:'Approved'},'finance'),/credit limit/i);
 s=act(s,'finance.invoice',{orderId:o.id,taxBps:0,dueDate:'2026-09-28',notes:'',creditLimitOverrideReason:'Approved by finance head'},'admin');
 assert.equal(s.invoices.at(-1)?.type,'gas');
});

test('document numbers have type and fiscal year series',()=>{
 let s=seed(); const o=s.orders.find(x=>x.id==='o-partial-1')!;
 s=act(s,'order.unload',{orderId:o.id,cylinderIds:['c-004'],notes:'Done'},'operations');
 s=act(s,'finance.invoice',{orderId:o.id,taxBps:0,dueDate:'2026-09-28',notes:''},'admin');
 assert.match(s.invoices.at(-1)!.number,/^GINV-2026-27-\d{5}$/);
 s=act(s,'finance.credit',{invoiceId:s.invoices.at(-1)!.id,reason:'Cancelled'},'finance');
 assert.match(s.invoices.at(-1)!.number,/^CN-2026-27-\d{5}$/);
});

test('party and settings versions reject stale same-record edits',()=>{
 let s=seed(); const p=s.parties.find(x=>x.id==='p-home-1')!;
 const fields={name:p.name,type:p.type,contact:p.contact,phone:p.phone,address:p.address,city:p.city,gstin:p.gstin,branchId:p.branchId,creditLimitPaise:p.creditLimitPaise,dailyRentalPaise:p.dailyRentalPaise,freeDays:p.freeDays,depositPaise:p.depositPaise};
 s=act(s,'party.update',{partyId:p.id,expectedVersion:1,...fields},'admin');
 denies(()=>act(s,'party.update',{partyId:p.id,expectedVersion:1,...fields},'admin'),/version/i);
 const settings={companyName:s.settings.companyName,address:s.settings.address,gstin:s.settings.gstin,defaultTaxBps:s.settings.defaultTaxBps};
 s=act(s,'settings.update',{expectedVersion:1,...settings},'admin');
 denies(()=>act(s,'settings.update',{expectedVersion:1,...settings},'admin'),/version/i);
});

test('incident rent stop refuses an already billed rental date',()=>{
 let s=seed(); const c=s.cylinders.find(x=>x.id==='c-001')!;
 s=act(s,'cylinder.offsiteIncident',{cylinderId:c.id,version:c.version,kind:'lost',notes:'Missing'});
 s.invoices.push({...s.invoices[0],id:'billed-rent-test',type:'rental',partyId:'p-hospital-1',sourceId:'rental:2026-09-22:2026-09-27',status:'issued'});
 const v=s.cylinders.find(x=>x.id===c.id)!.version;
 denies(()=>act(s,'rental.stopIncident',{cylinderId:c.id,version:v,stopDate:'2026-09-27',reason:'Approved'}),/already billed/i);
});

test('writeoff can follow a separately approved rent stop at the same date',()=>{
 let s=seed(); const c=s.cylinders.find(x=>x.id==='c-001')!;
 s=act(s,'cylinder.offsiteIncident',{cylinderId:c.id,version:c.version,kind:'lost',notes:'Missing'});
 s=act(s,'rental.stopIncident',{cylinderId:c.id,version:s.cylinders.find(x=>x.id===c.id)!.version,stopDate:'2026-09-28',reason:'Stop approved'});
 s=act(s,'cylinder.writeoff',{cylinderId:c.id,version:s.cylinders.find(x=>x.id===c.id)!.version,stopDate:'2026-09-28',reason:'Lost confirmed'});
 assert.equal(s.cylinders.find(x=>x.id===c.id)?.condition,'retired');
});

test('fully credited delivered order can be reissued while original stays in ledger',()=>{
 let s=seed(); const original=s.invoices.find(x=>x.id==='inv-seed-1')!;
 s=act(s,'finance.credit',{invoiceId:original.id,reason:'Correct full invoice'},'finance');
 assert.equal(s.invoices.find(x=>x.id===original.id)?.status,'credited');
 s=act(s,'finance.invoice',{orderId:original.sourceId,taxBps:1200,dueDate:'2026-09-28',notes:'Corrected price',creditLimitOverrideReason:'Corrected replacement invoice'},'admin');
 assert.equal(s.invoices.filter(x=>x.type==='gas'&&x.sourceId===original.sourceId).length,2);
 assert.notEqual(s.invoices.at(-1)?.number,original.number);
});

test('supplier owner consent and rental policy are explicit at dispatch and delivery',()=>{
 let s=seed(); const c=s.cylinders.find(x=>x.id==='c-008')!;
 c.ownerId='p-supplier-1';
 const party=s.parties.find(x=>x.id==='p-hospital-1')!;
 s=act(s,'order.create',{partyId:party.id,branchId:c.branchId,gas:c.gas,size:c.size,quantity:1,priority:'normal',dueDate:'2026-09-28',notes:'',unitPricePaise:100},'operations');
 const order=s.orders.at(-1)!;
 denies(()=>act(s,'order.dispatch',{orderId:order.id,cylinderIds:[c.id],vehicle:'V',driverId:'u-driver'},'operations'),/Owner authorization/i);
 s=act(s,'settings.update',{companyName:s.settings.companyName,address:s.settings.address,gstin:s.settings.gstin,defaultTaxBps:s.settings.defaultTaxBps,supplierOwnedRental:'no_charge'},'admin');
 s=act(s,'order.dispatch',{orderId:order.id,cylinderIds:[c.id],vehicle:'V',driverId:'u-driver',ownerAuthorizationRef:'SUP-OK'},'operations');
 assert.match(s.movements[0].notes,/SUP-OK/);
 s=act(s,'order.deliver',{orderId:order.id,cylinderIds:[c.id],recipient:'Desk',notes:''},'operations');
 assert.equal(s.rentals.at(-1)?.dailyRatePaise,0);
});

test('unallocation rejects a corrected legacy target to avoid duplicate customer credit',()=>{
 let s=seed(); const source=s.invoices.find(x=>x.id==='inv-seed-1')!;
 source.paidPaise=source.totalPaise; source.status='paid';
 const target=structuredClone(source); target.id='credited-target-legacy'; target.number='GINV-LEGACY'; target.paidPaise=0; target.status='issued'; s.invoices.push(target);
 s=act(s,'finance.credit',{invoiceId:source.id,amountPaise:1000,reason:'Price correction'},'finance');
 const note=s.invoices.at(-1)!;
 s=act(s,'finance.creditAllocate',{creditInvoiceId:note.id,invoiceId:target.id,amountPaise:1000,reason:'Apply'},'finance');
 const receipt=s.receipts.at(-1)!;
 const current=s.invoices.find(x=>x.id===target.id)!;
 current.creditedPaise=current.totalPaise; current.status='credited';
 denies(()=>act(s,'finance.creditUnallocate',{receiptId:receipt.id,reason:'Correct prior allocation'},'finance'),/after invoice correction/i);
});
