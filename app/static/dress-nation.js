{
const ic=(n,c='')=>`<svg class="i ${c}"><use href="#i-${n}"/></svg>`;
const ksh=n=>'Ksh '+n.toLocaleString('en-KE');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* Catalogue is loaded from the live backend (see init at the bottom). */
const DRESSES=[];
const byId=id=>DRESSES.find(d=>d.id===id);
const DELIVERY=[
 {k:'pickup',t:'Pick up in Nairobi',s:'Collect from our Nairobi CBD point',p:0,i:'pin'},
 {k:'nairobi',t:'Delivery within Nairobi',s:'Rider delivery, 1–2 days',p:200,i:'bike'},
 {k:'country',t:'Countrywide delivery',s:'Courier to your town, 2–4 days',p:350,i:'truck'},
];
const STATUSES=['Order placed','Payment confirmed','Dispatched','Delivered'];

const load=(k,d)=>{try{return JSON.parse(localStorage.getItem('dn_'+k))??d}catch(e){return d}};
const save=(k,v)=>{try{localStorage.setItem('dn_'+k,JSON.stringify(v))}catch(e){}};
const S={bag:load('bag',[]),orders:load('orders',[]),sold:load('sold',[]),view:'mq',size:'all',cur:0,
  gi:0,gfor:0,form:{name:'',phone:'',del:'nairobi',area:'',agree:false,coupon:'',couponPct:0},pay:{mode:'stk',code:'',state:'idle'},admin:{tab:'orders',status:'Order placed'},
  auth:{loggedIn:false,phone:'',name:'',orders:[],coupons:[],step:'phone',msg:''}};
const persist=()=>{save('bag',S.bag);save('orders',S.orders);save('sold',S.sold)};
const isSold=id=>{const d=byId(id);return S.sold.includes(id)||!!(d&&d.sold);};
const inBag=id=>S.bag.includes(id);
const app=document.getElementById('app');

function toast(t){const el=document.getElementById('toast');el.textContent=t;el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),2200)}
function badge(bump){const b=document.getElementById('badge');b.textContent=S.bag.length||'';if(bump){b.classList.remove('bump');void b.offsetWidth;b.classList.add('bump')}}

async function addToBag(id,fromEl){
  if(isSold(id)||inBag(id))return;
  let r;
  try{r=await fetch('/shop/api/cart/add',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({productId:id})}).then(x=>x.json());}
  catch(e){toast('Could not reach the shop — please try again');return;}
  if(!r.ok){
    if(r.taken){S.sold.push(id);persist();toast('Sorry — that one was just reserved. Each piece is unique.');route==='shop'?refreshShop():render();}
    return;
  }
  S.bag=r.ids;persist();
  const target=document.getElementById('bagLink').getBoundingClientRect();
  const img=fromEl&&fromEl.querySelector('img');
  if(img&&!matchMedia('(prefers-reduced-motion:reduce)').matches){
    const r=img.getBoundingClientRect();const f=document.createElement('div');f.className='fly';
    f.style.cssText=`left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    f.innerHTML=`<img src="${img.getAttribute('src')}" alt="">`;document.body.appendChild(f);
    const dx=target.left+target.width/2-(r.left+r.width/2),dy=target.top+target.height/2-(r.top+r.height/2);
    f.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${dx*.55}px,${dy*.4-60}px) scale(.45)`,opacity:1,offset:.55},{transform:`translate(${dx}px,${dy}px) scale(.06)`,opacity:.3}],{duration:850,easing:'cubic-bezier(.5,0,.3,1)'}).onfinish=()=>{f.remove();badge(true)};
  } else badge(true);
  toast(byId(id).name+' is in your bag');
  route==='shop'?refreshShop():render();
}

/* ---------- SHOP ---------- */
let ringRAF=0,ringPos=0,ringTarget=0,ringAuto=0,ringHover=false;
function shop(){
  const d=DRESSES[S.cur];
  const list=DRESSES.filter(x=>S.size==='all'||x.sizes.includes(+S.size));
  return `<div class="view">
  <section class="stage">
    <div class="stage-head wrap"><div class="eyebrow">The fitting room</div><h1>Boutique looks. Thrift prices.</h1>
      <div class="view-toggle" role="group" aria-label="Photo view"><button data-v="mq" class="${S.view==='mq'?'on':''}">On the mannequin</button><button data-v="md" class="${S.view==='md'?'on':''}">On a model</button></div></div>
    <div class="ring" id="ring" aria-label="Dresses in the fitting room — drag or use arrow keys" tabindex="0">
      ${DRESSES.map((x,i)=>`<div class="slot" data-i="${i}"><div class="float" style="animation-delay:${-i*.75}s"><button class="dress" data-pick="${i}" aria-label="Try on ${esc(x.name)}"><img src="${S.view==='mq'?x.mq:x.md}" alt="${esc(x.name)}" draggable="false"></button></div><div class="shadow" style="animation-delay:${-i*.75}s"></div></div>`).join('')}
      <div class="ring-nav"><button data-step="-1" aria-label="Previous dress">${ic('left')}</button><button data-step="1" aria-label="Next dress">${ic('right')}</button></div>
    </div>
    <div class="stage-bottom"><div class="wrap"><div class="trying" id="trying">${tryingCard(d)}</div></div></div>
  </section>
  <section class="section" id="drop"><div class="wrap">
    <div class="drop-head"><div><h2>This week's drop</h2><p class="muted">Hand-picked, cleaned and checked. One of each.</p></div>
      <div class="chips">${['all',8,10,12,14,16].map(s=>`<button class="chip ${String(S.size)===String(s)?'on':''}" data-size="${s}">${s==='all'?'All sizes':'Size '+s}</button>`).join('')}</div></div>
    ${list.length?`<div class="grid">${list.map(card).join('')}</div>`:
    `<div class="empty"><div class="ic">${ic('shirt')}</div><h3>No size ${esc(S.size)} this week</h3><p>New pieces land every week. Try another size.</p><button class="btn primary" data-size="all">Show all sizes</button></div>`}
  </div></section>
  <section class="section" style="padding-top:0"><div class="wrap">
    <h2>How to order</h2>
    <div class="steps">${[['shirt','Pick your dress','Try it on in the fitting room and add it to your bag.'],['truck','Choose delivery','Pick up in Nairobi, or we deliver anywhere in Kenya.'],['phone','Pay with M-Pesa','Pay to our till, or get a payment request on your phone.'],['chat','Confirm on WhatsApp','We confirm your order on WhatsApp and send it out.']].map((s,i)=>`<div class="step"><div class="n">0${i+1} ${ic(s[0])}</div><h3>${s[1]}</h3><p>${s[2]}</p></div>`).join('')}</div>
    <div class="two">
      <div class="panel tint">${ic('truck')}<h3>Delivery</h3><ul>${DELIVERY.map(x=>`<li>${x.k==='country'?'Countrywide courier':x.t} — ${x.p?ksh(x.p):'free'}</li>`).join('')}</ul></div>
      <div class="panel">${ic('shield')}<h3>Our policy, plainly</h3><p>Every dress is pre-loved and one of a kind. Please check the size before you pay: <strong>we don't offer refunds or exchanges.</strong></p></div>
    </div>
  </div></section></div>`;
}
function tryingCard(d){
  const sold=isSold(d.id),bagged=inBag(d.id);
  return `<div class="swap"><div class="eyebrow">Trying on</div><h2>${esc(d.name)}</h2>
  <dl class="specs"><div><dt>Size</dt><dd>${d.size}</dd></div><div><dt>Fabric</dt><dd>${esc(d.fabric)}</dd></div><div><dt>Price</dt><dd>${ksh(d.price)}</dd></div></dl>
  <p class="note">${sold?'Sold — someone got lucky. New pieces land every week.':'One of one — once it\'s gone, it\'s gone.'} <a class="textlink" href="#dress-${d.id}">More photos, video and details ${ic('arrow')}</a></p>
  <div class="actions">${sold?`<button class="btn soft" disabled>Sold</button>`:bagged?`<a class="btn soft" href="#bag">${ic('bag')} In your bag — view</a>`:`<button class="btn primary" data-add="${d.id}" data-from="ring">${ic('bag')} Add to bag · ${ksh(d.price)}</button>`}
  <button class="round" data-shuffle aria-label="Try another dress">${ic('refresh')}</button></div></div>`;
}
function card(d){
  const sold=isSold(d.id),bagged=inBag(d.id),i=DRESSES.indexOf(d);
  return `<article class="pcard" data-id="${d.id}"><a class="pimg" href="#dress-${d.id}" aria-label="View ${esc(d.name)}">
    <img src="${S.view==='mq'?d.mq:d.md}" alt="${esc(d.name)}" loading="lazy"><img class="hov" src="${S.view==='mq'?d.md:d.mq}" alt="" loading="lazy">
    <span class="tag">Size ${d.size}</span>${sold?'<span class="sold-cover"><span>Sold</span></span>':''}</a>
    <div class="pmeta"><a class="plink" href="#dress-${d.id}">${esc(d.name)}</a><span class="price">${ksh(d.price)}</span></div>
    <div class="psub">Size ${d.size} · ${esc(d.fabric)}</div>
    ${sold?`<button class="btn outline" disabled>Sold</button>`:bagged?`<a class="btn soft" href="#bag">In your bag — view</a>`:`<button class="btn outline" data-add="${d.id}">Add to bag</button>`}
  </article>`;
}
let N=DRESSES.length;const wrapd=v=>((v%N)+N)%N,near=o=>((o+N/2)%N+N)%N-N/2;
let drag=null;
function drawRing(){
    const ring=document.getElementById('ring');if(!ring)return;
    const slots=ring.querySelectorAll('.slot');
    const narrow=ring.clientWidth<600,R=narrow?ring.clientWidth*.42:Math.min(ring.clientWidth*.36,440);
    slots.forEach((s,i)=>{
      let o=i-ringPos;o=((o+N/2)%N+N)%N-N/2;
      const a=o*(narrow?.62:.55),x=Math.sin(a)*R,z=(Math.cos(a)-1)*R*1.1,ao=Math.abs(o);
      const sc=ao<.5?1+(.5-ao)*.12:1;
      s.style.transform=`translate3d(${x}px,${-ao*6}px,${z}px) scale(${sc}) rotateY(${-a*18}deg)`;
      s.style.zIndex=String(100-Math.round(ao*10));
      s.style.filter=ao<.5?'none':`blur(${Math.min(ao*.7,2.4)}px) brightness(${1-Math.min(ao*.05,.18)})`;
      s.style.opacity=String(ao>3.4?0:1-Math.max(0,ao-2.4)*.6);
    });
}
function tick(){ringPos+=(ringTarget-ringPos)*.12;drawRing();if(Math.abs(ringTarget-ringPos)>.001)ringRAF=requestAnimationFrame(tick);else{ringPos=ringTarget;drawRing()}}
function go(t){ringTarget=t;cancelAnimationFrame(ringRAF);ringRAF=requestAnimationFrame(tick);const c=wrapd(Math.round(t));if(c!==S.cur){S.cur=c;const tr=document.getElementById('trying');if(tr)tr.innerHTML=tryingCard(DRESSES[c])}}
function goTo(i){go(Math.round(ringTarget)+near(i-wrapd(Math.round(ringTarget))))}
function setupRing(){
  const ring=document.getElementById('ring');if(!ring)return;
  ringTarget=Math.round(ringTarget);if(wrapd(ringTarget)!==S.cur)ringTarget=S.cur;ringPos=ringTarget;drawRing();
  ring.addEventListener('pointerdown',e=>{if(e.target.closest('.ring-nav'))return;drag={sx:e.clientX,start:ringTarget,moved:0,w:ring.clientWidth};ring.classList.add('drag')});
  ring.addEventListener('click',e=>{const p=e.target.closest('[data-pick]');if(p&&!(ring._moved>6)){const i=+p.dataset.pick;if(i===S.cur&&wrapd(Math.round(ringTarget))===i)location.hash='dress-'+DRESSES[i].id;else goTo(i)}
    const st=e.target.closest('[data-step]');if(st)go(Math.round(ringTarget)+ +st.dataset.step)});
  ring.addEventListener('keydown',e=>{if(e.key==='ArrowRight')go(Math.round(ringTarget)+1);if(e.key==='ArrowLeft')go(Math.round(ringTarget)-1)});
  // Auto-play the carousel: gently turn to the next dress, pausing while the
  // shopper hovers, drags or has the tab in the background.
  ring.addEventListener('pointermove',e=>{ringHover=!!e.target.closest('.dress')});
  ring.addEventListener('pointerleave',()=>ringHover=false);
  clearInterval(ringAuto);
  if(DRESSES.length>1&&!matchMedia('(prefers-reduced-motion:reduce)').matches){
    ringAuto=setInterval(()=>{
      if(!document.getElementById('ring')||drag||ringHover||document.hidden)return;
      go(Math.round(ringTarget)+1);
    },2600);
  }
  observeCards();
}
function observeCards(){
  const io=new IntersectionObserver(es=>es.forEach(en=>{if(en.isIntersecting){en.target.classList.add('in');io.unobserve(en.target)}}),{threshold:.12});
  document.querySelectorAll('.pcard:not(.in)').forEach((c,i)=>{c.style.transitionDelay=(i%4)*80+'ms';io.observe(c)});
}
addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.sx;drag.moved=Math.max(drag.moved,Math.abs(dx));ringTarget=drag.start-dx/(drag.w*.22);cancelAnimationFrame(ringRAF);ringRAF=requestAnimationFrame(tick)});
addEventListener('pointerup',()=>{if(!drag)return;const ring=document.getElementById('ring');if(ring){ring.classList.remove('drag');ring._moved=drag.moved}drag=null;go(Math.round(ringTarget))});
addEventListener('resize',drawRing);
function refreshShop(){
  const tr=document.getElementById('trying');if(tr)tr.innerHTML=tryingCard(DRESSES[S.cur]);
  document.querySelectorAll('.pcard').forEach(c=>{const d=byId(+c.dataset.id);const tmp=document.createElement('div');tmp.innerHTML=card(d);const n=tmp.firstElementChild;n.classList.add('in');c.replaceWith(n)});
}

/* ---------- BAG ---------- */
function bag(){
  if(!S.bag.length)return emptyView('bag','Your bag is empty','Every dress is one of a kind. Try a few on in the fitting room.','#shop','Go to the fitting room');
  const items=S.bag.map(byId),sub=items.reduce((a,b)=>a+b.price,0);
  return `<div class="narrow view"><div class="stephead"><div class="eyebrow">Step 1 of 3</div><h1>Your bag</h1><p class="muted">${items.length} dress${items.length>1?'es':''} · held until someone pays first</p></div>
  ${items.map((d,i)=>`<div class="line" style="animation-delay:${i*70}ms"><img src="${d.mq}" alt=""><div class="grow"><h3>${esc(d.name)}</h3><div class="small">Size ${d.size} · ${esc(d.fabric)}</div><div style="margin-top:4px">${ksh(d.price)}</div></div><button class="x" data-remove="${d.id}" aria-label="Remove ${esc(d.name)}">${ic('x')}</button></div>`).join('')}
  <div class="box"><div class="row"><span>Subtotal</span><b class="v">${ksh(sub)}</b></div><p class="small" style="margin:4px 0 16px">Delivery fee is shown on the next step, before you pay.</p>
  <a class="btn primary block" href="#details">Continue to delivery ${ic('arrow')}</a></div></div>`;
}

/* ---------- DETAILS ---------- */
const phoneOk=p=>/^(?:\+?254|0)(?:7|1)\d{8}$/.test(p.replace(/\s/g,''));
function totals(){const items=S.bag.map(byId),sub=items.reduce((a,b)=>a+b.price,0),del=DELIVERY.find(x=>x.k===S.form.del);const discount=S.form.couponPct?Math.round(sub*S.form.couponPct/100):0;return{items,sub,del,discount,total:sub-discount+del.p}}
function summaryBox(){const t=totals();return `<div class="summary">${t.items.map(d=>`<div class="row"><span>${esc(d.name)} · size ${d.size}</span><span class="v">${ksh(d.price)}</span></div>`).join('')}${t.discount?`<div class="row" style="color:var(--olive,#5c6534)"><span>Coupon ${esc(S.form.coupon)} (−${S.form.couponPct}%)</span><span class="v">−${ksh(t.discount)}</span></div>`:''}<hr><div class="row muted"><span>${t.del.t}</span><span class="v">${t.del.p?ksh(t.del.p):'Free'}</span></div><div class="row total"><span>Total</span><span class="v">${ksh(t.total)}</span></div></div>`}
function details(){
  if(!S.bag.length)return emptyView('bag','Nothing to check out yet','Add a dress to your bag first.','#shop','Go to the fitting room');
  if(S.auth.loggedIn&&!S.form.phone)S.form.phone=S.auth.phone;
  const f=S.form;
  return `<div class="mid view"><div class="stephead"><div class="eyebrow">Step 2 of 3</div><h1>Where should we send it?</h1></div>
  <form id="detailsForm" novalidate>
    <h3 style="font-size:16px">Your contact</h3>
    <label class="f" for="fname">Full name</label><input class="inp" id="fname" autocomplete="name" value="${esc(f.name)}">
    <label class="f" for="fphone">Phone (WhatsApp)</label><input class="inp" id="fphone" inputmode="tel" autocomplete="tel" placeholder="07XX XXX XXX" value="${esc(f.phone)}">
    <div id="phoneErr" class="err" hidden>Enter a Kenyan number, e.g. 0712 345 678</div>
    <p class="small" style="margin:6px 0 0">We confirm your order on WhatsApp.</p>
    <h3 style="font-size:16px;margin:28px 0 10px">Delivery</h3>
    ${DELIVERY.map(x=>`<button type="button" class="opt ${f.del===x.k?'on':''}" data-del="${x.k}" aria-pressed="${f.del===x.k}">${ic(x.i)}<span class="grow"><b style="font-weight:500">${x.t}</b><br><span class="small">${x.s}</span></span><span class="p">${x.p?ksh(x.p):'Free'}</span><span class="radio"></span></button>`).join('')}
    ${f.del==='pickup'?'':`<label class="f" for="farea">${f.del==='country'?'Town, area and landmark':'Area and landmark'}</label><input class="inp" id="farea" value="${esc(f.area)}">`}
    <h3 style="font-size:16px;margin:28px 0 10px">Coupon</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <input class="inp" id="coupon" placeholder="Have a code? e.g. CHRISTMAS" value="${esc(f.coupon)}" style="flex:1 1 180px;text-transform:uppercase">
      <button type="button" class="btn soft" data-coupon>Apply</button>
    </div>
    <div id="couponMsg" class="small" style="margin-top:6px">${f.couponPct?`<span style="color:var(--olive,#5c6534)">✓ ${esc(f.coupon)} — ${f.couponPct}% off applied</span>`:''}</div>
    <div id="sumBox">${summaryBox()}</div>
    <div class="box"><h3 style="font-size:16px">No refunds, no exchanges</h3><p class="small" style="margin:4px 0 0">These are pre-loved, one-of-a-kind dresses. Please check the size before you pay.</p>
      <label class="check"><input type="checkbox" id="fagree" ${f.agree?'checked':''}> I understand and agree</label></div>
    <button class="btn primary block" id="toPay" style="margin-top:16px" ${canPay()?'':'disabled'}>Continue to payment</button>
  </form></div>`;
}
function canPay(){const f=S.form;return f.name.trim().length>1&&phoneOk(f.phone)&&f.agree&&(f.del==='pickup'||f.area.trim().length>1)}
async function applyCoupon(){
  const inp=document.getElementById('coupon'),msg=document.getElementById('couponMsg');
  const code=((inp&&inp.value)||'').trim().toUpperCase();
  const refresh=()=>{const sb=document.getElementById('sumBox');if(sb)sb.innerHTML=summaryBox();};
  if(!code){S.form.coupon='';S.form.couponPct=0;if(msg)msg.innerHTML='';refresh();return}
  if(msg)msg.innerHTML='<span class="small">Checking…</span>';
  let r;try{r=await fetch('/shop/api/coupon/'+encodeURIComponent(code)).then(x=>x.json())}catch(e){r=null}
  if(r&&r.valid){S.form.coupon=r.code;S.form.couponPct=r.percent;if(msg)msg.innerHTML='<span style="color:var(--olive,#5c6534)">✓ '+esc(r.code)+' — '+r.percent+'% off applied</span>';}
  else{S.form.coupon='';S.form.couponPct=0;if(msg)msg.innerHTML='<span style="color:#b3261e">That code isn\'t valid.</span>';}
  refresh();
}

/* ---------- PAYMENT ---------- */
function payment(){
  if(S.pay.state==='done'){const o=S.orders[0];return `<div class="narrow view" style="text-align:center;padding-top:72px"><div class="done-ic">${ic('check')}</div><h1>Order placed</h1><p class="muted" style="max-width:420px;margin:10px auto 26px">Thank you, ${esc(o.name.split(' ')[0])}. We'll confirm order <b>${o.id}</b> on WhatsApp at ${esc(o.phone)} and send it out.</p><a class="btn primary" href="#orders">Track my order</a> <a class="btn outline" href="#shop">Keep browsing</a></div>`}
  if(!S.bag.length)return emptyView('wallet','Nothing to pay for','Your bag is empty, or your order has been placed.','#shop','Go to the fitting room');
  if(!canPay())return emptyView('wallet','Add your delivery details first','We need your name, WhatsApp number and delivery choice.','#details','Back to details');
  const t=totals(),p=S.pay;
  return `<div class="narrow view"><div class="stephead"><div class="eyebrow">Step 3 of 3</div><h1>Pay with M-Pesa</h1><p class="muted">Total to pay: <b style="color:var(--charcoal)">${ksh(t.total)}</b></p></div>
  ${p.state==='waiting'?`<div class="box waiting"><div class="pulse">${ic('phone')}</div><h3>Request sent to your phone</h3><p class="muted">Check ${esc(S.form.phone)} and enter your M-Pesa PIN there — never on this site.</p><p class="small">${ic('load','spin')} Waiting for M-Pesa…</p></div>`:`
  <div class="tabs" role="tablist"><button class="${p.mode==='stk'?'on':''}" data-pm="stk">Send request to my phone</button><button class="${p.mode==='till'?'on':''}" data-pm="till">Pay to our till</button></div>
  ${p.mode==='stk'?`<div class="box" style="margin-top:0"><p style="margin:0 0 14px">We'll send an M-Pesa request for <b>${ksh(t.total)}</b> to <b>${esc(S.form.phone)}</b>. Enter your PIN on your phone.</p><button class="btn primary block" data-stk>${ic('phone')} Send payment request</button></div>`:
  `<div class="box" style="margin-top:0"><p style="margin:0">Go to M-Pesa → Lipa na M-Pesa → Buy Goods, and pay <b>${ksh(t.total)}</b> to:</p>
   <div class="till"><span class="small">Till number</span><b>123 456</b></div><p class="small" style="margin:6px 0 0">Sample till for this prototype — swap in your own.</p>
   <label class="f" for="mcode">M-Pesa confirmation code</label><input class="inp" id="mcode" placeholder="e.g. SKL4X8P2QD" maxlength="10" autocapitalize="characters" value="${esc(p.code)}">
   <div id="codeErr" class="err" hidden>That doesn't look like an M-Pesa code. It's 10 letters and numbers.</div>
   <button class="btn primary block" data-till style="margin-top:16px">Confirm payment</button></div>`}`}
  ${summaryBox()}</div>`;
}
async function placeOrder(method){
  let res;
  try{res=await fetch('/shop/api/order',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({name:S.form.name.trim(),phone:S.form.phone.trim(),del:S.form.del,area:S.form.area,method,coupon:S.form.coupon})}).then(r=>r.json());}
  catch(e){S.pay.state='idle';toast('Could not reach the shop — please try again');render();return;}
  if(!res||res.error){S.pay.state='idle';toast((res&&res.error)||'Something went wrong — please try again');
    try{S.bag=await fetch('/shop/api/cart').then(r=>r.json()).then(d=>d.ids);}catch(e){}persist();badge();render();return;}
  const o=res.order;
  S.orders.unshift({id:o.dn,ref:{id:o.id,token:o.token},items:o.items.map(i=>i.id),name:o.name,phone:o.phone,del:o.del,total:o.total,method:o.method,status:o.status,at:Date.now()});
  S.sold.push(...o.items.map(i=>i.id));S.bag=[];S.pay.state='done';persist();badge();render();
}

/* ---------- ORDERS ---------- */
function orders(){
  if(!S.orders.length)return emptyView('package','No orders yet','When you place an order, you\'ll follow it here from payment to your door.','#shop','Find a dress');
  return `<div class="mid view"><div class="stephead"><div class="eyebrow">My orders</div><h1>Your orders</h1><p class="muted">Follow each order from payment to your door.</p></div>
  ${S.orders.map((o,i)=>`<div class="order" style="animation-delay:${i*70}ms"><div class="top"><div><h3>${o.id}</h3><div class="small">${new Date(o.at).toLocaleDateString('en-KE',{day:'numeric',month:'short',year:'numeric'})} · ${esc(o.del)}</div></div><div style="text-align:right"><span class="pill ${o.status===3?'g':''}">${STATUSES[o.status]}</span><div style="margin-top:6px;font-weight:500">${ksh(o.total)}</div></div></div>
  <div class="thumbs">${o.items.map(id=>`<img src="${byId(id).mq}" alt="${esc(byId(id).name)}" title="${esc(byId(id).name)}">`).join('')}</div>
  <div class="track">${STATUSES.map((s,j)=>`<div class="${j<=o.status?'ok':''}">${s}</div>`).join('')}</div></div>`).join('')}</div>`;
}

/* ---------- ADMIN ---------- */
function admin(){
  const a=S.admin,cnt=k=>S.orders.filter(o=>o.status===k).length;
  const tiles=[['load','Payments to confirm',0],['wallet','Ready to dispatch',1],['truck','On the way',2],['package','Delivered',3]];
  const list=S.orders.filter(o=>a.status==='All'||STATUSES[o.status]===a.status);
  return `<div class="mid view"><div class="eyebrow">Admin</div><h1 style="margin-top:6px">Today at Dress Nation</h1><p class="muted">Orders placed in this prototype show here.</p>
  <div class="stats">${tiles.map(t=>`<button class="stat ${a.status===STATUSES[t[2]]?'on':''}" data-ast="${STATUSES[t[2]]}">${ic(t[0])}<b>${cnt(t[2])}</b><span>${t[1]}</span></button>`).join('')}</div>
  <div class="under"><button class="${a.tab==='orders'?'on':''}" data-atab="orders">Orders</button><button class="${a.tab==='dresses'?'on':''}" data-atab="dresses">Dresses</button></div>
  ${a.tab==='orders'?`<div class="chips" style="margin-bottom:18px">${['All',...STATUSES].map(s=>`<button class="chip ${a.status===s?'on':''}" data-ast="${s}">${s}</button>`).join('')}</div>
   ${list.length?list.map(o=>`<div class="arow"><img src="${byId(o.items[0]).mq}" alt=""><div><b style="font-weight:500">${o.id} · ${esc(o.name)}</b><div class="small">${o.items.map(id=>esc(byId(id).name)).join(', ')} · ${ksh(o.total)} · ${o.method==='till'?'Till':'Phone request'} · ${esc(o.del)}</div></div>
     ${o.status<3?`<button class="btn outline" data-adv="${o.id}">${['Confirm payment','Mark dispatched','Mark delivered'][o.status]}</button>`:'<span class="pill g">Delivered</span>'}</div>`).join(''):
   `<div class="empty" style="padding:56px 20px"><div class="ic">${ic('inbox')}</div><h3>${S.orders.length?'Nothing here right now':'No orders yet'}</h3><p>${S.orders.length?'You\'re all caught up for this status.':'Place an order through the shop, or load demo orders to try the admin flow.'}</p>${S.orders.length?'':'<button class="btn primary" data-demo>Load demo orders</button>'}</div>`}`
  :`${DRESSES.map(d=>`<div class="arow"><img src="${d.mq}" alt=""><div><b style="font-weight:500">${esc(d.name)}</b><div class="small">Size ${d.size} · ${esc(d.fabric)} · ${ksh(d.price)}</div></div><button class="btn ${isSold(d.id)?'soft':'outline'}" data-sold="${d.id}">${isSold(d.id)?'Sold — relist':'Available — mark sold'}</button></div>`).join('')}`}
  </div>`;
}

/* ---------- DRESS DETAIL ---------- */
function mediaLayer(m,d){
  return m.type==='video'
   ?`<div class="glayer"><video src="${m.src}" poster="${m.poster}" muted loop playsinline autoplay controls aria-label="${esc(d.name)} video"></video></div>`
   :`<div class="glayer zoomable"><img src="${m.src}" alt="${esc(d.name)} — ${m.alt}"></div>`;
}
function dressView(id){
  const d=byId(id);if(!d)return emptyView('shirt','We couldn\'t find that dress','It may have been taken down. Have a look at this week\'s drop.','#shop','Go to the fitting room');
  const sold=isSold(d.id),bagged=inBag(d.id),i=DRESSES.indexOf(d);
  if(S.gfor!==d.id){S.gfor=d.id;S.gi=0}
  const others=DRESSES.filter(x=>x.id!==d.id).sort((a,b)=>isSold(a.id)-isSold(b.id)).slice(0,4);
  const st=n=>`style="animation-delay:${n*70}ms"`;
  return `<div class="wrap dress-view view">
  <a class="back" href="#drop">${ic('left')} Back to this week's drop</a>
  <div class="dgrid">
    <div class="gallery ${sold?'is-sold':''}">
      <div class="gmain" id="gmain" tabindex="0" aria-label="Photos and video — use arrow keys">${mediaLayer(d.media[S.gi],d)}
        ${sold?'<span class="sold-cover"><span>Sold</span></span>':''}
        <button class="gnav prev" data-g="-1" aria-label="Previous photo">${ic('left')}</button><button class="gnav next" data-g="1" aria-label="Next photo">${ic('right')}</button>
        <span class="gcount" id="gcount">${S.gi+1} / ${d.media.length}</span>
      </div>
      <div class="gthumbs">${d.media.map((m,k)=>`<button class="gthumb ${k===S.gi?'on':''}" data-gi="${k}" aria-label="${m.alt}"><img src="${m.type==='video'?m.poster:m.src}" alt="">${m.type==='video'?`<span class="play">${ic('play')}</span>`:''}</button>`).join('')}</div>
    </div>
    <div class="dinfo">
      <div class="eyebrow" ${st(1)}>Size ${d.size} · One of one</div>
      <h1 ${st(2)}>${esc(d.name)}</h1>
      <div class="dprice" ${st(3)}><span>${ksh(d.price)}</span>${sold?'<span class="pill">Sold</span>':bagged?'<span class="pill w">In your bag</span>':'<span class="pill g">Available</span>'}</div>
      <p class="lead" ${st(4)}>${esc(d.short)}</p>
      <dl class="dspecs" ${st(5)}><div><dt>Size</dt><dd>${d.size}</dd></div><div><dt>Fabric</dt><dd>${esc(d.fabric)}</dd></div><div><dt>Colour</dt><dd>${esc(d.colour)}</dd></div><div><dt>Length</dt><dd>${esc(d.length)}</dd></div></dl>
      <div class="dactions" ${st(6)}>${sold?`<button class="btn soft block" disabled>Sold — someone got lucky</button>`:bagged?`<a class="btn soft block" href="#bag">${ic('bag')} In your bag — view</a>`:`<button class="btn primary block" data-add="${d.id}" data-from="gallery">${ic('bag')} Add to bag · ${ksh(d.price)}</button>`}
        <button class="btn outline block" data-tryon="${i}">Try it on in the fitting room</button></div>
      <ul class="dnotes" ${st(7)}><li>${ic('truck')}<span>Free pick-up in Nairobi CBD, Ksh 200 in Nairobi, Ksh 350 countrywide.</span></li><li>${ic('shield')}<span>Pre-loved and one of a kind. <strong>No refunds or exchanges</strong>, so please check the size.</span></li><li>${ic('chat')}<span>We confirm every order on WhatsApp.</span></li></ul>
      <div class="advisor stylist-card" ${st(8)}>
        <span class="sc-tag">NEW</span>
        <details open>
          <summary>
            <span class="sc-ico">💬</span>
            <h3 class="sc-title">Ask our Stylist</h3>
            <span class="sc-chev"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
          </summary>
          <hr class="sc-div">
          <p class="small" style="margin:0 0 10px">A personal answer for <b>Ksh ${window.DN_STYLIST_PRICE}</b> — get it here or on WhatsApp with the photo.</p>
          <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px;font-size:14px">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="styCh" value="web" checked> Here on the page</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="styCh" value="whatsapp"> On WhatsApp</label>
          </div>
          <input class="inp" id="styPhone" placeholder="WhatsApp number, e.g. 0712 345 678" style="display:none;width:100%;margin-bottom:10px">
          <div class="sc-opt fit">
            <h4>📏 Will it fit me?</h4>
            <p class="sc-hint">Tell us your height, usual size and shape — we'll say honestly if it suits.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <input class="inp" id="fitq" placeholder="I'm 5'5, UK 10, curvy hips…" style="flex:1 1 220px">
              <button class="btn outline" data-fit="${d.id}" style="border-color:#1e88e5;color:#1565c0">Will it fit me? · Ksh ${window.DN_STYLIST_PRICE}</button>
            </div>
            <div id="fitout" style="margin-top:10px"></div>
          </div>
          <div class="sc-opt style">
            <h4>✨ How to style it</h4>
            <p class="sc-hint">Shoes, bags and jewellery ideas for day, evening and office.</p>
            <button class="btn soft" data-style="${d.id}" style="background:#fce4ec;color:#ad1457">How to style it ✨ · Ksh ${window.DN_STYLIST_PRICE}</button>
            <div id="styleout" style="margin-top:10px"></div>
          </div>
        </details>
      </div>
    </div>
  </div>
  <section class="dmore">
    <div><h2>About this dress</h2>${d.long.map(p=>`<p>${esc(p)}</p>`).join('')}</div>
    <div class="panel"><h3 style="margin-top:0">Fit and care</h3><ul>${d.care.map(c=>`<li>${ic('check')}<span>${esc(c)}</span></li>`).join('')}</ul></div>
  </section>
  <section class="section" style="padding-top:8px"><h2 style="margin-bottom:24px">More from this week's drop</h2><div class="grid">${others.map(card).join('')}</div></section>
  </div>`;
}
function showMedia(k){
  const d=byId(S.gfor),g=document.getElementById('gmain');if(!d||!g)return;
  S.gi=(k+d.media.length)%d.media.length;
  g.querySelectorAll('video').forEach(v=>v.pause());
  const old=g.querySelectorAll('.glayer'),tmp=document.createElement('div');tmp.innerHTML=mediaLayer(d.media[S.gi],d);
  const nl=tmp.firstElementChild;nl.classList.add('incoming');g.prepend(nl);
  requestAnimationFrame(()=>requestAnimationFrame(()=>nl.classList.remove('incoming')));
  old.forEach(o=>{o.classList.add('leaving');setTimeout(()=>o.remove(),550)});
  document.querySelectorAll('.gthumb').forEach((t,j)=>t.classList.toggle('on',j===S.gi));
  const on=document.querySelector('.gthumb.on'),row=on&&on.parentElement;
  if(row)row.scrollTo({left:on.offsetLeft-row.clientWidth/2+on.clientWidth/2,behavior:'smooth'});
  document.getElementById('gcount').textContent=`${S.gi+1} / ${d.media.length}`;
}
function setupGallery(){
  const g=document.getElementById('gmain');if(!g)return;
  g.addEventListener('pointermove',e=>{if(e.pointerType!=='mouse')return;const im=g.querySelector('.glayer:not(.leaving) img');if(!im)return;const r=g.getBoundingClientRect();im.style.transformOrigin=`${(e.clientX-r.left)/r.width*100}% ${(e.clientY-r.top)/r.height*100}%`});
  let sx=null;
  g.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse')sx=e.clientX});
  g.addEventListener('pointerup',e=>{if(sx===null)return;const dx=e.clientX-sx;sx=null;if(Math.abs(dx)>40)showMedia(S.gi+(dx<0?1:-1))});
  g.addEventListener('keydown',e=>{if(e.key==='ArrowRight')showMedia(S.gi+1);if(e.key==='ArrowLeft')showMedia(S.gi-1)});
  observeCards();
}

function emptyView(i,h,p,href,cta){return `<div class="empty view"><div class="ic">${ic(i)}</div><h3>${h}</h3><p>${p}</p><a class="btn primary" href="${href}">${cta}</a></div>`}

/* ---------- ACCOUNT (phone + WhatsApp code login) ---------- */
function updateAcctLabel(){const el=document.getElementById('acctLbl');if(el)el.textContent=S.auth.loggedIn?'Account':'Sign in';}
async function loadAccount(){
  let r;try{r=await fetch('/shop/api/account').then(x=>x.json())}catch(e){r=null}
  S.auth=r&&r.loggedIn
    ?{loggedIn:true,phone:r.phone,name:r.name||'',orders:r.orders||[],coupons:r.coupons||[],step:'phone',msg:''}
    :{loggedIn:false,phone:(S.auth&&S.auth.phone)||'',name:'',orders:[],coupons:[],step:'phone',msg:''};
  updateAcctLabel();
  if(route==='account')render();
}
async function requestCode(){
  const phone=((document.getElementById('authPhone')||{}).value||'').trim();S.auth.phone=phone;
  if(phone.replace(/\D/g,'').length<9){S.auth.msg='Enter a valid Kenyan number.';render();return}
  S.auth.msg='Sending…';render();
  let r;try{r=await fetch('/shop/api/auth/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone})}).then(x=>x.json())}catch(e){r=null}
  if(r&&r.sent){S.auth.step='code';S.auth.msg='Code sent on WhatsApp — enter it below.';}else{S.auth.msg=(r&&r.error)||'Could not send the code.';}
  render();
}
async function verifyCode(){
  const phone=S.auth.phone,code=((document.getElementById('authCode')||{}).value||'').trim();
  if(code.length<4){S.auth.msg='Enter the code we sent.';render();return}
  S.auth.msg='Verifying…';render();
  let r;try{r=await fetch('/shop/api/auth/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone,code})}).then(x=>x.json())}catch(e){r=null}
  if(r&&r.ok){await loadAccount();}else{S.auth.msg=(r&&r.error)||'Wrong or expired code.';render();}
}
async function logoutAcct(){try{await fetch('/shop/api/auth/logout',{method:'POST'})}catch(e){}S.auth={loggedIn:false,phone:'',name:'',orders:[],coupons:[],step:'phone',msg:''};updateAcctLabel();location.hash='shop';}
function account(){
  const a=S.auth;
  if(!a.loggedIn){
    return `<div class="narrow view"><div class="stephead"><div class="eyebrow">Account</div><h1>Sign in</h1><p class="muted">Enter your phone and we'll send a login code on WhatsApp.</p></div>
    <div class="box">
      <label class="f" for="authPhone">Phone (WhatsApp)</label><input class="inp" id="authPhone" inputmode="tel" placeholder="07XX XXX XXX" value="${esc(a.phone)}">
      <button class="btn primary block" data-authreq style="margin-top:12px">${a.step==='code'?'Resend code':'Send code'}</button>
      ${a.step==='code'?`<label class="f" for="authCode" style="margin-top:16px">Enter the 6-digit code</label><input class="inp" id="authCode" inputmode="numeric" placeholder="123456"><button class="btn primary block" data-authverify style="margin-top:12px">Verify &amp; sign in</button>`:''}
      ${a.msg?`<div class="small" style="margin-top:10px">${esc(a.msg)}</div>`:''}
    </div></div>`;
  }
  const orders=a.orders||[],coupons=(a.coupons||[]).filter(c=>!c.used);
  return `<div class="mid view"><div class="stephead"><div class="eyebrow">My account</div><h1>Hi${a.name?' '+esc(a.name):''} 👋</h1><p class="muted">${esc(a.phone)} · <a class="textlink" href="#account" data-logout>Log out</a></p></div>
  <h2 style="font-size:20px;margin:0 0 10px">Your coupons</h2>
  ${coupons.length?`<div class="two" style="margin-bottom:26px">${coupons.map(c=>`<div class="box" style="margin:0"><b>${esc(c.code)}</b> — ${c.percent}% off<div class="small">Apply it at checkout.</div></div>`).join('')}</div>`:`<p class="muted" style="margin-bottom:26px">No coupons yet — earn one after a few orders.</p>`}
  <h2 style="font-size:20px;margin:0 0 10px">Your orders</h2>
  ${orders.length?orders.map(o=>`<div class="order"><div class="top"><div><h3>${esc(o.dn)}</h3><div class="small">${new Date(o.at).toLocaleDateString('en-KE',{day:'numeric',month:'short',year:'numeric'})} · ${esc(o.del)}</div></div><div style="text-align:right"><span class="pill ${o.status===3?'g':''}">${STATUSES[o.status]}</span><div style="margin-top:6px;font-weight:500">${ksh(o.total)}</div></div></div></div>`).join(''):`<p class="muted">No orders yet.</p>`}
  </div>`;
}

const WA=()=>window.DN_WA||'';
function styChannel(){return (document.querySelector('input[name="styCh"]:checked')||{}).value||'web';}
// Gate the fit/style buttons: logged-in = free; others pay (or redeem a coupon) first.
document.addEventListener('click',function(e){
  var btn=e.target.closest&&e.target.closest('[data-fit],[data-style]');
  if(!btn)return;
  if(S.auth.loggedIn)return;              // logged-in customers skip payment
  if(btn.dataset.paid==='1')return;       // already paid this session
  var kind=btn.hasAttribute('data-fit')?'fit':'style';
  if(kind==='fit'){var q=document.getElementById('fitq');if(!q||q.value.trim().length<2)return;} // let askStylist focus empty input
  e.stopImmediatePropagation();e.preventDefault();
  openPayDialog(btn,kind,Number(btn.getAttribute('data-'+kind)));
},true);
function openPayDialog(btn,kind,dressId){
  var price=window.DN_STYLIST_PRICE,amount=price,coupon=null;
  var dlg=document.createElement('dialog');dlg.className='paydlg';
  dlg.innerHTML=''
    +'<h3 style="margin:0 0 4px">'+(kind==='fit'?'Will it fit me?':'How to style it ✨')+'</h3>'
    +'<p style="font-size:.9rem;opacity:.75;margin:0 0 14px">Pay Ksh <span id="pdAmt">'+price+'</span> by M-Pesa. Enter the number to get the prompt on.</p>'
    +'<input id="pdPhone" class="inp" type="tel" inputmode="numeric" autocomplete="tel" placeholder="07XX XXX XXX" style="width:100%">'
    +'<div style="margin-top:8px"><a href="#" id="pdCouponLink" class="textlink" style="font-size:.85rem">Have a coupon code?</a></div>'
    +'<div id="pdCouponRow" style="display:none;gap:8px;margin-top:8px"><input id="pdCode" class="inp" placeholder="Enter code" style="flex:1;text-transform:uppercase"><button class="btn outline" id="pdApply">Apply</button></div>'
    +'<div id="pdCoupMsg" style="font-size:.85rem;margin-top:6px"></div>'
    +'<div class="err" id="pdErr" style="color:#c62828;font-size:.85rem;min-height:1.2em;margin-top:6px"></div>'
    +'<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn outline" id="pdCancel">Cancel</button><button class="btn" id="pdPay">Pay Ksh <span id="pdPayAmt">'+price+'</span></button></div>'
    +'<p style="font-size:.8rem;margin-top:12px">Have an account? <a href="#account" id="pdSignin">Sign in</a></p>';
  document.body.appendChild(dlg);dlg.showModal();
  var err=dlg.querySelector('#pdErr'),phone=dlg.querySelector('#pdPhone'),pay=dlg.querySelector('#pdPay');
  function setAmount(a){amount=a;dlg.querySelector('#pdAmt').textContent=a;var pa=dlg.querySelector('#pdPayAmt');if(pa)pa.textContent=a;}
  function cleanup(){try{dlg.close()}catch(e){}if(dlg.parentNode)dlg.remove();}
  dlg.addEventListener('close',function(){if(dlg.parentNode)dlg.remove();});
  dlg.querySelector('#pdCancel').addEventListener('click',cleanup);
  dlg.querySelector('#pdSignin').addEventListener('click',function(){cleanup();location.hash='account';});
  dlg.querySelector('#pdCouponLink').addEventListener('click',function(e){e.preventDefault();dlg.querySelector('#pdCouponRow').style.display='flex';this.style.display='none';});
  function resetCoupon(){coupon=null;setAmount(price);phone.style.display='';pay.innerHTML='Pay Ksh <span id="pdPayAmt">'+price+'</span>';dlg.querySelector('#pdCoupMsg').textContent='';}
  dlg.querySelector('#pdApply').addEventListener('click',async function(){
    var code=(dlg.querySelector('#pdCode').value||'').trim().toUpperCase(),msg=dlg.querySelector('#pdCoupMsg');
    if(!code)return;err.textContent='';
    var r;try{r=await fetch('/api/stylist/coupon',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:code,dressId:dressId,kind:kind})}).then(x=>x.json())}catch(e){r=null}
    if(!r||!r.ok){msg.textContent='';err.textContent=(r&&r.error)||'That code isn\'t valid.';return;}
    coupon=code;setAmount(r.amount);
    if(r.amount<=0){phone.style.display='none';pay.innerHTML='Get my answer';msg.innerHTML='<span style="color:#2e7d32">Coupon applied — this one\'s free 🎉</span> <a href="#" id="pdRemove">Remove</a>';}
    else{phone.style.display='';pay.innerHTML='Pay Ksh <span id="pdPayAmt">'+r.amount+'</span>';msg.innerHTML='<span style="color:#2e7d32">Coupon applied — you pay Ksh '+r.amount+'</span> <a href="#" id="pdRemove">Remove</a>';}
    var rm=dlg.querySelector('#pdRemove');if(rm)rm.addEventListener('click',function(e){e.preventDefault();resetCoupon();});
  });
  pay.addEventListener('click',async function(){
    err.textContent='';var body={dressId:dressId,kind:kind};if(coupon)body.coupon=coupon;
    if(amount>0){var digits=(phone.value||'').replace(/\D/g,'').replace(/^0/,'254');if(!/^254(7|1)\d{8}$/.test(digits)){err.textContent='Enter a valid Safaricom number';return;}body.phone=digits;err.textContent='Check your phone for the M-Pesa prompt…';}
    var r;try{r=await fetch('/api/stylist/pay',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(x=>x.json())}catch(e){err.textContent='Network error, try again';return;}
    if(r&&r.ok){cleanup();btn.dataset.paid='1';btn.click();}else{err.textContent=(r&&r.error)||'Payment failed, try again';}
  });
}
// Paid stylist request: pay (simulated) then deliver on web or WhatsApp.
async function askStylist(id,mode){
  const out=document.getElementById(mode==='fit'?'fitout':'styleout');
  const channel=styChannel();
  const phone=((document.getElementById('styPhone')||{}).value||'').trim();
  const message=((document.getElementById('fitq')||{}).value||'').trim();
  if(mode==='fit'&&message.length<2){const q=document.getElementById('fitq');q&&q.focus();return}
  if(channel==='whatsapp'&&phone.replace(/\D/g,'').length<9){out.innerHTML='<span class="small">Enter your WhatsApp number above first.</span>';return}
  out.innerHTML='<span class="small">Asking the stylist…</span>';
  let r;try{r=await fetch('/shop/api/stylist/'+id,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode,message,channel,phone})}).then(x=>x.json())}catch(e){r=null}
  if(!r||r.unavailable){out.innerHTML='<span class="small">Our stylist isn\'t online right now — <a class="textlink" href="https://wa.me/'+WA()+'">ask us on WhatsApp</a>.</span>';return}
  if(r.error){out.innerHTML='<span class="small">'+esc(r.error)+'</span>';return}
  if(r.sent){out.innerHTML='<div class="box" style="margin-top:0"><p style="margin:0">✅ Sent to your WhatsApp ('+esc(phone)+') with the dress photo.</p></div>';return}
  const a=r.advice||{};
  if(mode==='fit'){
    out.innerHTML='<div class="box" style="margin-top:0"><p style="margin:0">'+esc(a.stylist_reply||'')+'</p>'+(a.recommended_size?'<p class="small" style="margin:6px 0 0">Suggested size: <b>'+esc(a.recommended_size)+'</b></p>':'')+'</div>';
  }else{
    let html='<div class="box" style="margin-top:0"><ul style="margin:0;padding-left:18px">';
    (a.styling_tips||[]).forEach(t=>html+='<li>'+esc(t)+'</li>');
    html+='</ul>';const by=a.by_occasion||{};
    for(const k in by)html+='<p class="small" style="margin:6px 0 0"><b>'+esc(k)+':</b> '+esc(by[k])+'</p>';
    out.innerHTML=html+'</div>';
  }
}

/* ---------- router ---------- */
// Admin lives on the real server-rendered dashboard (/admin), not in the SPA.
const ROUTES={shop,bag,details,payment,orders,account};
const TITLES={shop:'Try on this week\'s dresses',bag:'Your bag',details:'Delivery details',payment:'Payment',orders:'My orders',account:'My account'};
let route='shop';
let dressId=0;
function render(){
  const y=scrollY;
  app.innerHTML=route==='dress'?dressView(dressId):ROUTES[route]();
  document.querySelectorAll('[data-nav]').forEach(a=>a.classList.toggle('on',a.dataset.nav===route));
  document.title=(route==='dress'?(byId(dressId)||{name:'Dress'}).name:TITLES[route])+' — Dress Nation ~254';
  if(route==='shop'){setupRing();scrollTo(0,y)}
  if(route==='dress'){setupGallery();scrollTo(0,y)}
}
function onHash(){
  const h=location.hash.slice(1),dm=h.match(/^dress-(\d+)$/);
  const next=dm?'dress':ROUTES[h]?h:'shop';
  if(next!=='payment'&&S.pay.state==='done'){S.pay.state='idle';S.pay.code=''}
  const changed=next!==route||(dm&&+dm[1]!==dressId);route=next;if(dm)dressId=+dm[1];
  if(changed)scrollTo({top:0,behavior:'instant'});
  render();
  if(h==='drop'){const el=document.getElementById('drop');if(el)el.scrollIntoView({behavior:'instant'})}
  if(route==='orders')refreshOrders();
}
addEventListener('hashchange',onHash);
// Pull live status for placed orders so the tracker reflects the shop's admin.
let ordersRefreshing=false;
async function refreshOrders(){
  if(ordersRefreshing||!S.orders.length)return;ordersRefreshing=true;
  try{
    await Promise.all(S.orders.map(async o=>{
      if(!o.ref)return;
      try{const s=await fetch('/shop/api/order/'+o.ref.id+'/'+o.ref.token).then(r=>r.ok?r.json():null);
        if(s)o.status=s.status;}catch(e){}
    }));
    persist();
  }finally{ordersRefreshing=false;}
  if(route==='orders')render();
}

app.addEventListener('click',e=>{
  const t=e.target.closest('button,a');if(!t)return;const ds=t.dataset;
  if(ds.add){const fromEl=ds.from==='ring'?document.querySelector(`#ring [data-pick="${S.cur}"]`):ds.from==='gallery'?document.getElementById('gmain'):t.closest('.pcard');addToBag(+ds.add,fromEl)}
  else if(ds.shuffle!==undefined){const opts=DRESSES.map((d,i)=>i).filter(i=>i!==S.cur&&!isSold(DRESSES[i].id));goTo(opts.length?opts[Math.floor(Math.random()*opts.length)]:S.cur)}
  else if(ds.v){S.view=ds.v;render()}
  else if(ds.size){S.size=ds.size;render();if(t.closest('.empty'))document.getElementById('drop').scrollIntoView()}
  else if(ds.tryon){const i=+ds.tryon;S.cur=i;ringTarget=i;ringPos=i;location.hash='shop'}
  else if(ds.fit){askStylist(+ds.fit,'fit')}
  else if(ds.style){askStylist(+ds.style,'style')}
  else if(ds.g){showMedia(S.gi+ +ds.g)}
  else if(ds.gi){showMedia(+ds.gi)}
  else if(ds.remove){const pid=+ds.remove;S.bag=S.bag.filter(x=>x!==pid);persist();badge();render();
    fetch('/shop/api/cart/remove',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({productId:pid})}).catch(()=>{});}
  else if(ds.del){S.form.del=ds.del;render()}
  else if(ds.coupon!==undefined){applyCoupon()}
  else if(ds.authreq!==undefined){requestCode()}
  else if(ds.authverify!==undefined){verifyCode()}
  else if(ds.logout!==undefined){e.preventDefault();logoutAcct()}
  else if(ds.pm){S.pay.mode=ds.pm;render()}
  else if(ds.stk!==undefined){S.pay.state='waiting';render();setTimeout(()=>{if(S.pay.state==='waiting'&&route==='payment')placeOrder('stk')},3800)}
  else if(ds.till!==undefined){const c=(document.getElementById('mcode').value||'').trim().toUpperCase();S.pay.code=c;if(!/^[A-Z0-9]{10}$/.test(c)||!/[A-Z]/.test(c)){document.getElementById('codeErr').hidden=false;document.getElementById('mcode').classList.add('bad')}else placeOrder('till')}
  else if(ds.ast){S.admin.status=ds.ast;S.admin.tab='orders';render()}
  else if(ds.atab){S.admin.tab=ds.atab;render()}
  else if(ds.adv){const o=S.orders.find(x=>x.id===ds.adv);if(o&&o.status<3){o.status++;persist();toast(o.id+' → '+STATUSES[o.status]);render()}}
  else if(ds.sold){const id=+ds.sold;S.sold=isSold(id)?S.sold.filter(x=>x!==id):[...S.sold,id];S.bag=S.bag.filter(x=>!S.sold.includes(x));persist();badge();render()}
  else if(ds.demo!==undefined){const now=Date.now();S.orders=[
    {id:'DN-1031',items:[2],name:'Wanjiru K.',phone:'0712 345 678',del:'Delivery within Nairobi',total:1200,method:'stk',status:0,at:now-36e5},
    {id:'DN-1032',items:[6,7],name:'Achieng O.',phone:'0722 111 222',del:'Countrywide delivery',total:2350,method:'till',status:0,at:now-72e5},
    {id:'DN-1029',items:[3],name:'Mumbi N.',phone:'0700 987 654',del:'Pick up in Nairobi',total:1000,method:'till',status:1,at:now-864e5},
    {id:'DN-1027',items:[8],name:'Faith M.',phone:'0111 222 333',del:'Delivery within Nairobi',total:1200,method:'stk',status:2,at:now-1728e5}];
    S.sold=[...new Set([...S.sold,2,6,7,3,8])];S.bag=S.bag.filter(x=>!S.sold.includes(x));persist();badge();toast('Demo orders loaded (sample data)');render()}
});
app.addEventListener('input',e=>{
  const id=e.target.id,f=S.form;
  if(id==='fname')f.name=e.target.value;else if(id==='fphone'){f.phone=e.target.value;const bad=f.phone.replace(/\s/g,'').length>=10&&!phoneOk(f.phone);document.getElementById('phoneErr').hidden=!bad;e.target.classList.toggle('bad',bad)}
  else if(id==='farea')f.area=e.target.value;else if(id==='fagree')f.agree=e.target.checked;else if(id==='coupon')f.coupon=e.target.value;
  else if(id==='mcode'){S.pay.code=e.target.value;document.getElementById('codeErr').hidden=true;e.target.classList.remove('bad')}
  const b=document.getElementById('toPay');if(b)b.disabled=!canPay();
});
app.addEventListener('change',e=>{if(e.target.id==='fagree'){S.form.agree=e.target.checked;const b=document.getElementById('toPay');if(b)b.disabled=!canPay()}
  if(e.target.name==='styCh'){const p=document.getElementById('styPhone');if(p)p.style.display=styChannel()==='whatsapp'?'block':'none';}});
app.addEventListener('submit',e=>{e.preventDefault();if(canPay())location.hash='payment'});

/* ---------- init: load the live catalogue, then boot ---------- */
async function loadCatalogue(){
  try{
    const res=await fetch('/shop/api/catalogue',{headers:{accept:'application/json'}});
    const data=await res.json();
    DRESSES.length=0;
    for(const d of data.dresses){
      // The ring and thumbnails use d.mq (mannequin) and d.md (model).
      d.mq=d.mannequin;d.md=d.model;
      DRESSES.push(d);
    }
  }catch(e){ /* leave DRESSES empty; views show their empty states */ }
  N=DRESSES.length;  // the ring math (wrapd/near/drawRing) needs the real count
  // The server cart (cookie-backed) is the source of truth for the bag so holds
  // survive reloads and match the reservations.
  try{S.bag=await fetch('/shop/api/cart').then(r=>r.json()).then(d=>d.ids);}catch(e){}
  // Drop any sold ids that are no longer in the catalogue.
  const ids=new Set(DRESSES.map(d=>d.id));
  S.bag=S.bag.filter(id=>ids.has(id));
  S.sold=S.sold.filter(id=>ids.has(id));
  if(S.cur>=DRESSES.length)S.cur=0;
  persist();
}
loadCatalogue().then(()=>{badge();onHash();loadAccount();});
}
