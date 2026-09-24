/* ====================== Trip content ====================== */

var SEED_ITINERARY = [
  { day:1, date:"17 Nov", weekday:"Tuesday", stay:"Kandy", title:"Colombo Airport → Kandy",
    items:[["Morning","Depart Bangalore, land in Colombo, pick up the rental car"],
           ["Morning","Drive to Kandy — about 3–3.5 hrs"],["1:30 PM","Lunch"],
           ["2:30 PM","Temple of the Sacred Tooth Relic"],["4:00 PM","Kandy Lake"],
           ["5:00 PM","Bahirawakanda Buddha viewpoint"],["6:00 PM","Explore Kandy town"],
           ["7:30 PM","Dinner"],["9:00 PM","Hotel / relax"]],
    tip:"Keep it an early night — hill country driving tomorrow." },
  { day:2, date:"18 Nov", weekday:"Wednesday", stay:"Nuwara Eliya", title:"Kandy → Nuwara Eliya",
    items:[["8:00 AM","Breakfast, then checkout"],["—","Drive to Nuwara Eliya — about 2.5–3 hrs"],
           ["11:30 AM","Arrive, tea plantation + tea factory"],["1:30 PM","Lunch"],
           ["2:30 PM","Gregory Lake"],["4:00 PM","Victoria Park"],
           ["5:00 PM","Explore town / colonial area"],["7:30 PM","Dinner"],["9:30 PM","Sleep"]],
    tip:"Tea country and a relaxed hill-station day — one night here is enough." },
  { day:3, date:"19 Nov", weekday:"Thursday", stay:"Ella (night 1 of 2)", title:"Nuwara Eliya → Ella",
    items:[["8:00 AM","Breakfast"],
           ["8:30 AM","Choose one: tea estate / Lover's Leap Waterfall / Ramboda Falls / a relaxed café"],
           ["10:30 AM","Checkout"],["—","Drive to Ella — about 2–2.5 hrs"],
           ["1:00 PM","Arrive, lunch, hotel check-in"],
           ["3:00 PM","Nine Arch Bridge ⭐⭐⭐⭐⭐ and Little Adam's Peak ⭐⭐⭐⭐"],
           ["6:00 PM","Back to hotel"],["7:30 PM","Dinner, then relax"]], tip:"" },
  { day:4, date:"20 Nov", weekday:"Friday", stay:"Ella (night 2 of 2)", title:"Full Ella day",
    items:[["8:30 AM","Breakfast"],
           ["9:30 AM","Ella Rock (proper hike) or Ravana Falls + viewpoints (easier)"],
           ["12:30 PM","Lunch"],["2:00 PM","Ella town — cafés, shopping, spa, relax at the hotel"],
           ["7:30 PM","Dinner, then drinks"],["10:00 PM","Ella bar hopping — backpacker/social scene"]], tip:"" },
  { day:5, date:"21 Nov", weekday:"Saturday", stay:"Mirissa", title:"Ella → Mirissa",
    items:[["10:00 AM","Wake up (later start after Friday night), breakfast"],
           ["11:30 AM","Checkout, leave Ella"],["—","Drive to Mirissa — about 3.5–4.5 hrs"],
           ["4:30 PM","Arrive, check in"],["5:30 PM","Mirissa Beach, sunset, Coconut Tree Hill"],
           ["7:30 PM","Dinner"],["9:00 PM","Beach bars — the main party night"]],
    tip:"If you're drinking, leave the rental car at the hotel and use tuk-tuks or taxis." },
  { day:6, date:"22 Nov", weekday:"Sunday", stay:"Colombo", title:"Mirissa → Galle → Colombo",
    items:[["10:00 AM","Wake up, breakfast"],
           ["11:30 AM","Beach time — pick 1–2: surfing, snorkelling, kayaking, swimming"],
           ["1:30 PM","Lunch, then leave Mirissa"],["—","Drive to Galle — about 1–1.5 hrs"],
           ["4:00 PM","Galle Fort — walls, lighthouse, colonial streets, cafés, shopping"],
           ["6:30 PM","Sunset at the Fort"],["8:30 PM","Dinner, then leave for Colombo"],
           ["—","Drive to Colombo — about 2–2.5 hrs"],["~12:00 AM","Arrive Colombo"]],
    tip:"Your biggest combined day — pace it and don't try to do everything on the beach." },
  { day:7, date:"23 Nov", weekday:"Monday", stay:"Departure", title:"Colombo → Departure",
    items:[["Morning","Sightsee in Colombo"],["Afternoon","Departure flight to Bangalore"]], tip:"" }
];

// [route, duration, trip day it happens on]
var DRIVE_LEGS = [["Airport → Kandy","~3–3.5h",1],["Kandy → N'Eliya","~2.5–3h",2],
  ["N'Eliya → Ella","~2–2.5h",3],["Ella → Mirissa","~3.5–4.5h",5],
  ["Mirissa → Galle","~1–1.5h",6],["Galle → Colombo","~2–2.5h",6]];

var CATEGORIES = [
  {id:"flights",label:"Flights",icon:"✈️"},
  {id:"stay",label:"Stay",icon:"🏨"},{id:"food",label:"Food",icon:"🍛"},
  {id:"transport",label:"Transport",icon:"🚗"},{id:"activity",label:"Activity",icon:"🥾"},
  {id:"shopping",label:"Shopping",icon:"🛍️"},{id:"other",label:"Other",icon:"📌"}
];

var VALID_CATEGORIES = CATEGORIES.map(function(c){ return c.id; });
var MAX_DESC_LEN = 80, MAX_NAME_LEN = 40, MAX_UPI_LEN = 60, MAX_AMOUNT = 10000000;

/* ---- Trip settings (shared, editable in the app) ----
   Stored in Firestore at trip/settings. These defaults come from the
   Sri_Lanka_Plan spreadsheet (6 adults) and are used until someone saves. */
var DEFAULT_SETTINGS = {
  startDate: "2026-11-17",
  endDate:   "2026-11-23",
  airportRate: null,            // LKR you get for ₹1 at the airport counter, e.g. 3.40
  budget: { flights:168000, stay:34300, food:58800, transport:53500, activity:0, shopping:0, other:0 }
};
function cloneSettings(x){ return JSON.parse(JSON.stringify(x)); }

var MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var WEEKDAY_LONG = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
function pad2(n){ return (n<10?"0":"")+n; }
function ymdToDate(ymd){
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd||""));
  return m ? new Date(+m[1], +m[2]-1, +m[3]) : null;
}
function dateToYmd(d){ return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate()); }
function addDays(d, n){ var x = new Date(d.getTime()); x.setDate(x.getDate()+n); return x; }
function todayYmd(){ return dateToYmd(new Date()); }
function fmtDayMonth(d){ return d.getDate()+" "+MONTH_SHORT[d.getMonth()]; }
function fmtYmdShort(ymd){ var d = ymdToDate(ymd); return d ? fmtDayMonth(d) : ""; }
function tripStart(){ return ymdToDate(S.settings.startDate) || ymdToDate(DEFAULT_SETTINGS.startDate); }
function tripLength(){
  var a = tripStart(), b = ymdToDate(S.settings.endDate);
  if(!b) return 7;
  return Math.max(1, Math.min(30, Math.round((b - a)/86400000) + 1));
}
function dayDate(n){ return addDays(tripStart(), n-1); }
function tripRangeLabel(){
  var a = tripStart(), b = dayDate(tripLength());
  if(a.getMonth()===b.getMonth() && a.getFullYear()===b.getFullYear()) return a.getDate()+"–"+b.getDate()+" "+MONTH_SHORT[b.getMonth()];
  return fmtDayMonth(a)+" – "+fmtDayMonth(b);
}
function isDuringTrip(){
  var t = todayYmd();
  return t >= S.settings.startDate && t <= dateToYmd(dayDate(tripLength()));
}

/* ---- Currency ----
   Balances are always in ₹. A bill can be entered in LKR; it's converted
   when saved, and the rate used is stored on the bill so every phone shows
   the same number (rates are never silently re-fetched later).
   Rates are "LKR per ₹1" (≈3.45), which is how money-changers quote them. */
function fmtLkr(v){
  var n = round2(v), frac = Math.round(Math.abs(n)*100) % 100 !== 0;
  return "LKR " + Number(n).toLocaleString("en-US", { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 });
}
function money(v, cur){ return cur === "LKR" ? fmtLkr(v) : inr(v); }
function curSymbol(cur){ return cur === "LKR" ? "Rs" : "₹"; }
function inrWhole(v){ return inr(Math.round(Number(v)||0)); }
function lkrToInr(v, lkrPerInr){ return round2(Number(v) / Number(lkrPerInr)); }
function validRate(r){ r = Number(r); return isFinite(r) && r >= 0.5 && r <= 50; }

var fxMem = {};
/** Market rate for a date (YYYY-MM-DD). Free, no key; two mirrors; cached
    on the phone so previously-seen dates work offline. Today/future → latest. */
function fetchLkrPerInr(ymd){
  var tag = (!ymd || ymd >= todayYmd()) ? "latest" : ymd;
  var cacheKey = "pw_fx_" + tag;
  if(fxMem[tag] && (tag !== "latest" || Date.now() - fxMem[tag].at < 3*3600e3)) return Promise.resolve(fxMem[tag]);
  var urls = [
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@"+tag+"/v1/currencies/inr.json",
    "https://"+tag+".currency-api.pages.dev/v1/currencies/inr.json"
  ];
  function attempt(i){
    if(i >= urls.length){
      var cached = null; try{ cached = JSON.parse(lsGet(cacheKey) || "null"); }catch(e){}
      if(cached && validRate(cached.rate)) return cached;
      throw new Error("Couldn't get the exchange rate (no signal?)");
    }
    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function(){ ctrl.abort(); }, 6000) : null;
    return fetch(urls[i], ctrl ? { signal: ctrl.signal } : undefined).then(function(r){
      if(timer) clearTimeout(timer); if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
      .then(function(j){
        var rate = j && j.inr && Number(j.inr.lkr);
        if(!validRate(rate)) throw new Error("bad rate");
        var out = { rate: Math.round(rate*10000)/10000, date: String(j.date||ymd||""), at: Date.now() };
        fxMem[tag] = out;
        lsSet(cacheKey, JSON.stringify(out));
        return out;
      })
      .catch(function(){ return attempt(i+1); });
  }
  return attempt(0);
}


/** Parses an item's time label ("2:30 PM") against a given day's Date. Returns a Date or null for non-clock labels like "Morning"/"—". */
function parseItemTime(baseDate, timeStr){
  var m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(timeStr||"").trim());
  if(!m || !baseDate) return null;
  var h = parseInt(m[1],10) % 12;
  if(/pm/i.test(m[3])) h += 12;
  var d = new Date(baseDate.getTime());
  d.setHours(h, parseInt(m[2],10), 0, 0);
  return d;
}

/* ====================== Firebase ====================== */

var auth = firebase.auth();
var db = firebase.firestore();
try{
  db.enablePersistence({ synchronizeTabs:true }).catch(function(err){
    // Multiple tabs open, or browser doesn't support it — app still works,
    // just without offline write queuing in that case.
    console.warn("Offline persistence unavailable:", err && err.code);
  });
} catch(e){}

var S = { me:"", myPhoto:"", joined:false, people:[], bills:[], settlements:[], itinerary:[], settings: cloneSettings(DEFAULT_SETTINGS), fetchedAt:"" };
var activeTab = "now";
var openDay = 1;
var booted = false;
var syncState = "ok";
var unsubPeople = null, unsubBills = null, unsubSettlements = null, unsubItinerary = null, unsubTrip = null;
var unsubRequests = null, unsubMyPerson = null, unsubMyRequest = null;
var latestSnapshots = { people:null, bills:null, settlements:null, itinerary:null, trip:null };
var itinerarySeeded = false;
var joinShown = false;

/* ====================== Helpers ====================== */

function esc(s){
  return String(s==null?"":s).replace(/[&<>"']/g,function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function round2(n){ return Math.round((Number(n)+Number.EPSILON)*100)/100; }
function inr(n){
  n = round2(n); var neg = n<0; n = Math.abs(n);
  var parts = n.toFixed(2).split("."), ip = parts[0], dec = parts[1];
  var last3 = ip.slice(-3), rest = ip.slice(0,-3);
  if(rest !== "") last3 = "," + last3;
  var grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g,",") + last3;
  return (neg?"−":"") + "₹" + grouped + (dec==="00"?"":"."+dec);
}
function normEmail(v){ return String(v==null?"":v).trim().toLowerCase(); }
function cleanText(v, maxLen){ return String(v==null?"":v).replace(/\s+/g," ").trim().slice(0,maxLen); }
function person(email){
  for(var i=0;i<S.people.length;i++) if(S.people[i].email===email) return S.people[i];
  return {email:email,name:email?email.split("@")[0]:"Unknown",upi:"",photo:""};
}
function pName(email){ return person(email).name; }
function initial(email){ return (pName(email)||"?").charAt(0).toUpperCase(); }
function catIcon(id){
  for(var i=0;i<CATEGORIES.length;i++) if(CATEGORIES[i].id===id) return CATEGORIES[i].icon;
  return "📌";
}
/** Builds a universal maps search link: opens the Google Maps app on
    Android, Apple/Google Maps (whichever is set up) on iOS via the browser,
    or Google Maps in a normal browser tab everywhere else. No platform
    sniffing needed — https://maps.google.com links are handled natively by
    both platforms' map apps when tapped. */
function mapsUrl(place){
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(place);
}
function mapsBtnHtml(place, extraStyle){
  if(!place) return "";
  return '<a class="map-pin" href="'+esc(mapsUrl(place))+'" target="_blank" rel="noopener" '+
    'title="Open in Maps" onclick="event.stopPropagation()" style="'+(extraStyle||"")+'">📍</a>';
}

function avatarHtml(email){
  var p = person(email);
  if(p.photo) return '<div class="avatar"><img src="'+esc(p.photo)+'" alt=""></div>';
  return '<div class="avatar">'+esc(initial(email))+'</div>';
}

var toastTimer=null;
function toast(msg, bad){
  var t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show" + (bad?" bad":"");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.className = "toast" + (bad?" bad":""); }, 2600);
}

/* ====================== Balance engine ====================== */

/** Splits `amount` (rupees) across people in proportion to `weights`
    ({email: weight}), working in whole paise with the largest-remainder
    method so the parts ALWAYS add up to exactly `amount` — no ₹0.01 drift,
    no phantom "pay ₹0.01" settlements. A weight of 0 means that person
    pays nothing. Ties go to the alphabetically-first email so every device
    computes identical results. Returns { email: paise }. */
function allocatePaise(amount, weights){
  var totalPaise = Math.round(Number(amount)*100);
  var emails = Object.keys(weights).filter(function(e){ return (Number(weights[e])||0) > 0; }).sort();
  var out = {};
  Object.keys(weights).forEach(function(e){ out[e] = 0; });
  var totalW = emails.reduce(function(s,e){ return s + Number(weights[e]); }, 0);
  if(!emails.length || totalW <= 0 || !isFinite(totalPaise)) return out;
  var assigned = 0, rema = [];
  emails.forEach(function(e){
    var exact = totalPaise * Number(weights[e]) / totalW;
    var fl = Math.floor(exact);
    out[e] = fl; assigned += fl;
    rema.push({ e:e, r: exact - fl });
  });
  rema.sort(function(a,b){ return (b.r - a.r) || (a.e < b.e ? -1 : a.e > b.e ? 1 : 0); });
  for(var i=0; assigned < totalPaise; i = (i+1) % rema.length){ out[rema[i].e]++; assigned++; }
  return out;
}

/** Per-person paise owed for one bill, honoring its split mode. */
function billSharesPaise(b){
  var people = b.split || [];
  var w = {};
  if(b.splitMode === "itemized" && Array.isArray(b.items)){
    var sum = {};
    b.items.forEach(function(item){
      var ip = item.people || [];
      if(!ip.length) return;
      var iw = {}, anyPct = false;
      ip.forEach(function(e){
        iw[e] = (item.mode === "percent" && item.percents) ? Math.max(0, Number(item.percents[e])||0) : 1;
        if(iw[e] > 0) anyPct = true;
      });
      if(!anyPct) ip.forEach(function(e){ iw[e] = 1; });
      var part = allocatePaise(round2(item.amount), iw);
      Object.keys(part).forEach(function(e){ sum[e] = (sum[e]||0) + part[e]; });
    });
    // Service charge, tax, discount…: each is split in proportion to what
    // each person's items came to, not equally.
    if(Array.isArray(b.extras) && b.extras.length){
      var base = {};
      Object.keys(sum).forEach(function(e){ base[e] = sum[e]; });
      b.extras.forEach(function(x){
        var part = allocatePaise(round2(x.amount), base);
        var sign = x.kind === "discount" ? -1 : 1;
        Object.keys(part).forEach(function(e){ sum[e] = (sum[e]||0) + sign*part[e]; });
      });
    }
    return sum;
  }
  if(b.splitMode === "exact" && b.splitAmounts){
    // Exact amounts are validated to within ₹0.02 of the total; use them as
    // weights so any tiny rounding gap is absorbed and totals match exactly.
    people.forEach(function(e){ w[e] = Math.max(0, Number(b.splitAmounts[e])||0); });
    var anyExact = people.some(function(e){ return w[e] > 0; });
    if(anyExact) return allocatePaise(b.amount, w);
  } else if(b.splitMode === "shares" && b.splitShares){
    people.forEach(function(e){ w[e] = Math.max(0, Number(b.splitShares[e])||0); });
    var anyShare = people.some(function(e){ return w[e] > 0; });
    if(anyShare) return allocatePaise(b.amount, w);
  }
  w = {}; people.forEach(function(e){ w[e] = 1; });
  return allocatePaise(b.amount, w);
}

/** Same as billSharesPaise but in rupees, for display. */
function billShares(b){
  var p = billSharesPaise(b), out = {};
  Object.keys(p).forEach(function(e){ out[e] = p[e]/100; });
  return out;
}

/** Balances computed in integer paise (exact), returned in rupees. */
function computeBalances(){
  var bal = {};
  S.people.forEach(function(p){ bal[p.email] = 0; });
  function add(e, paise){ bal[e] = (bal[e]||0) + paise; }
  S.bills.forEach(function(b){
    var shares = billSharesPaise(b), allocated = 0;
    Object.keys(shares).forEach(function(e){ add(e, -shares[e]); allocated += shares[e]; });
    add(b.paidBy, allocated);   // equals the bill amount for any valid bill
  });
  S.settlements.forEach(function(s){
    var p = Math.round(s.amount*100);
    add(s.from, p);
    add(s.to, -p);
  });
  var out = {};
  Object.keys(bal).forEach(function(e){ out[e] = bal[e]/100; });
  return out;
}

function computeSettlements(bal){
  var creditors = [], debtors = [];
  Object.keys(bal).forEach(function(e){
    var v = bal[e];
    if(v > 0.005) creditors.push({email:e, amt:v});
    else if(v < -0.005) debtors.push({email:e, amt:-v});
  });
  creditors.sort(function(a,b){ return b.amt-a.amt || a.email.localeCompare(b.email); });
  debtors.sort(function(a,b){ return b.amt-a.amt || a.email.localeCompare(b.email); });
  var out=[], i=0, j=0;
  while(i<debtors.length && j<creditors.length){
    var d=debtors[i], c=creditors[j];
    var amt = Math.min(d.amt, c.amt);
    if(amt > 0.005) out.push({from:d.email, to:c.email, amount:round2(amt)});
    d.amt = round2(d.amt-amt); c.amt = round2(c.amt-amt);
    if(d.amt <= 0.005) i++;
    if(c.amt <= 0.005) j++;
  }
  return out;
}

/* ====================== Validation (client-side mirror of old server checks) ====================== */

function validateBillCore(payload, peopleEmails){
  var desc = cleanText(payload && payload.desc, MAX_DESC_LEN);
  if(!desc) throw new Error("Add a short description for the bill.");

  var category = String((payload && payload.category) || "other").toLowerCase();
  if(VALID_CATEGORIES.indexOf(category)===-1) category = "other";

  var paidBy = normEmail(payload && payload.paidBy);
  if(peopleEmails.indexOf(paidBy)===-1) throw new Error("Whoever paid needs to have joined the trip first.");

  var splitMode = String((payload && payload.splitMode) || "equal").toLowerCase();
  if(["equal","exact","shares","itemized"].indexOf(splitMode)===-1) splitMode = "equal";

  if(splitMode === "itemized"){
    var rawItems = (payload && payload.items) || [];
    if(!Array.isArray(rawItems) || !rawItems.length) throw new Error("Add at least one line item.");
    var items = [], allPeople = [], total = 0;
    for(var ii=0; ii<rawItems.length; ii++){
      var ri = rawItems[ii];
      var idesc = cleanText(ri.desc, MAX_DESC_LEN);
      var iamt = round2(ri.amount);
      if(!idesc) throw new Error("Every line item needs a name.");
      if(!isFinite(iamt) || iamt<=0) throw new Error('Enter an amount for "'+idesc+'".');
      var ipeople = Array.isArray(ri.people) ? ri.people.map(normEmail).filter(function(e){return e;}) : [];
      ipeople = ipeople.filter(function(e,idx){ return ipeople.indexOf(e)===idx; });
      if(!ipeople.length) throw new Error('Pick who shared "'+idesc+'".');
      ipeople.forEach(function(e){
        if(peopleEmails.indexOf(e)===-1) throw new Error("Everyone in the split needs to have joined the trip first.");
        if(allPeople.indexOf(e)===-1) allPeople.push(e);
      });
      var imode = (ri.mode==="percent") ? "percent" : "equal";
      var item = { desc:idesc, amount:iamt, people:ipeople, mode:imode };
      if(imode==="percent"){
        var pcts = {}, pctSum = 0;
        ipeople.forEach(function(e){
          var p = Number(ri.percents && ri.percents[e]);
          if(!isFinite(p)||p<0) p = 0;
          pcts[e]=p; pctSum += p;
        });
        if(Math.abs(pctSum-100) > 0.5) throw new Error('"'+idesc+'" percentages need to add up to 100% (currently '+Math.round(pctSum)+'%).');
        item.percents = pcts;
      }
      items.push(item);
      total = round2(total+iamt);
    }
    if(!allPeople.length) throw new Error("Pick at least one person across the line items.");
    var extras = [], charges = 0, discounts = 0;
    ((payload && payload.extras) || []).forEach(function(x){
      var xd = cleanText(x && x.desc, MAX_DESC_LEN) || (x && x.kind === "discount" ? "Discount" : "Tax / service");
      var xa = round2(x && x.amount);
      if(!isFinite(xa) || xa <= 0) return;                     // blank extra rows are just skipped
      var kind = x.kind === "discount" ? "discount" : "charge";
      var ex = { desc: xd, amount: xa, kind: kind };
      if(x.pct != null && isFinite(Number(x.pct)) && Number(x.pct) > 0) ex.pct = Math.round(Number(x.pct)*100)/100;
      extras.push(ex);
      if(kind === "discount") discounts = round2(discounts + xa); else charges = round2(charges + xa);
    });
    if(discounts > total) throw new Error("The discount is more than the items cost — check the amounts.");
    var grand = round2(total + charges - discounts);
    if(!(grand > 0)) throw new Error("The bill total has to be more than zero.");
    return { desc:desc, amount:grand, category:category, paidBy:paidBy, split:allPeople, splitMode:"itemized", items:items, extras:extras };
  }

  var amount = round2(payload && payload.amount);
  if(!isFinite(amount) || amount<=0) throw new Error("Enter an amount greater than zero.");
  if(amount > MAX_AMOUNT) throw new Error("That amount looks too large — check the digits.");

  var rawSplit = (payload && payload.split) || [];
  if(!Array.isArray(rawSplit)) rawSplit = [];
  var split = [];
  for(var i=0;i<rawSplit.length;i++){
    var e = normEmail(rawSplit[i]);
    if(e && split.indexOf(e)===-1){
      if(peopleEmails.indexOf(e)===-1) throw new Error("Everyone in the split needs to have joined the trip first.");
      split.push(e);
    }
  }
  if(!split.length) throw new Error("Pick at least one person to split this between.");

  var out = { desc:desc, amount:amount, category:category, paidBy:paidBy, split:split, splitMode:splitMode };

  if(splitMode === "exact"){
    var rawAmts = (payload && payload.splitAmounts) || {};
    var amts = {}, sum = 0;
    split.forEach(function(e){
      var v = round2(rawAmts[e]);
      if(!isFinite(v) || v<0) v = 0;
      amts[e] = v; sum = round2(sum+v);
    });
    if(sum <= 0) throw new Error("Enter how much each person owes.");
    if(Math.abs(sum-amount) > 0.02) throw new Error("The exact amounts (" + inr(sum) + ") need to add up to the bill total (" + inr(amount) + ").");
    out.splitAmounts = amts;
  } else if(splitMode === "shares"){
    var rawShares = (payload && payload.splitShares) || {};
    var shares = {}, anyPositive = false;
    split.forEach(function(e){
      var v = Number(rawShares[e]);
      if(!isFinite(v) || v<0) v = 0;
      if(v>0) anyPositive = true;
      shares[e] = v;
    });
    if(!anyPositive) throw new Error("Give at least one person a share greater than zero.");
    out.splitShares = shares;
  }

  return out;
}

/** Validates in the bill's own currency (what the person typed), then
    converts money fields to ₹ for the balance math. For LKR bills the
    original amounts and the rate used are kept alongside. Exact-split
    amounts stay in the bill's currency: they're used as proportions, so the
    currency doesn't change who owes what share. */
function validateBill(payload, peopleEmails){
  var out = validateBillCore(payload, peopleEmails);
  var billDate = ymdToDate(payload && payload.billDate) ? payload.billDate : todayYmd();
  out.billDate = billDate;
  var cur = (payload && payload.currency === "LKR") ? "LKR" : "INR";
  out.currency = cur;
  if(cur === "INR"){ out.origAmount = null; out.fx = null; return out; }

  var fx = payload.fx || {};
  if(!validRate(fx.rate)) throw new Error("Set the exchange rate first (LKR for ₹1).");
  var rate = Number(fx.rate);
  out.fx = { rate: rate, source: (["day","airport","manual"].indexOf(fx.source) >= 0 ? fx.source : "manual"), date: String(fx.date || billDate) };

  if(out.splitMode === "itemized"){
    var origTotal = 0, inrTotal = 0;
    out.items = out.items.map(function(it){
      var inrAmt = lkrToInr(it.amount, rate);
      if(!(inrAmt > 0)) throw new Error('"'+it.desc+'" is too small to convert to ₹.');
      origTotal = round2(origTotal + it.amount);
      inrTotal = round2(inrTotal + inrAmt);
      return Object.assign({}, it, { origAmount: it.amount, amount: inrAmt });
    });
    var sign = 0;
    out.extras = (out.extras || []).map(function(x){
      var inrAmt = lkrToInr(x.amount, rate);
      if(!(inrAmt > 0)) throw new Error('"'+x.desc+'" is too small to convert to ₹.');
      sign = x.kind === "discount" ? -1 : 1;
      origTotal = round2(origTotal + sign*x.amount);
      inrTotal = round2(inrTotal + sign*inrAmt);
      return Object.assign({}, x, { origAmount: x.amount, amount: inrAmt });
    });
    out.origAmount = origTotal;
    out.amount = inrTotal;
    if(!(inrTotal > 0)) throw new Error("The bill total has to be more than zero.");
  } else {
    out.origAmount = out.amount;
    out.amount = lkrToInr(out.amount, rate);
    if(!(out.amount > 0)) throw new Error("That amount is too small to convert to ₹.");
  }
  return out;
}

/* ====================== Firestore bridge ====================== */

function setSync(st){
  syncState = st;
  var dot = document.getElementById("sync-dot");
  if(dot) dot.className = "sync-dot" + (st==="busy"?" busy":(st==="err"?" err":(st==="offline"?" offline":"")));
  updateOfflineBanner();
}

var isOffline = !navigator.onLine;
var pendingWrites = 0;

function updateOfflineBanner(){
  var b = document.getElementById("offline-banner");
  if(!b) return;
  if(isOffline){
    b.style.display = "flex";
    b.querySelector(".ob-text").textContent = pendingWrites > 0
      ? "Offline · " + pendingWrites + " change" + (pendingWrites===1?"":"s") + " will sync when you're back online"
      : "Offline · you can still add bills, they'll sync later";
  } else if(pendingWrites > 0){
    b.style.display = "flex";
    b.querySelector(".ob-text").textContent = "Syncing " + pendingWrites + " change" + (pendingWrites===1?"":"s") + "…";
  } else {
    b.style.display = "none";
  }
}

window.addEventListener("online", function(){ isOffline = false; updateOfflineBanner(); });
window.addEventListener("offline", function(){ isOffline = true; updateOfflineBanner(); });

function docId(email){
  // Firestore doc IDs can't contain '/'; emails are otherwise safe.
  return email.replace(/\//g,"_");
}

function newId(prefix){
  return prefix + "_" + Date.now().toString(36) + "_" + Math.floor(Math.random()*1e6).toString(36);
}

function tsToIso(ts){
  if(!ts) return "";
  if(typeof ts.toDate === "function") return ts.toDate().toISOString();
  return String(ts);
}

/** Rebuilds a stored line item field by field, so whatever is in the
    database can only ever be plain numbers and strings when it reaches the UI. */
function cleanStoredItem(it){
  if(!it || typeof it !== "object") return null;
  var amount = Number(it.amount);
  if(!isFinite(amount) || amount <= 0) return null;
  var people = Array.isArray(it.people) ? it.people.filter(function(e){ return typeof e === "string"; }).map(normEmail) : [];
  var percents = {};
  if(it.percents && typeof it.percents === "object"){
    people.forEach(function(e){ var v = Number(it.percents[e]); if(isFinite(v)) percents[e] = v; });
  }
  var out = { desc: cleanText(it.desc, MAX_DESC_LEN), amount: round2(amount), people: people, mode: it.mode === "percent" ? "percent" : "equal", percents: percents };
  var orig = Number(it.origAmount);
  if(isFinite(orig) && orig > 0) out.origAmount = round2(orig);
  return out;
}

function cleanStoredExtra(x){
  if(!x || typeof x !== "object") return null;
  var amount = Number(x.amount);
  if(!isFinite(amount) || amount <= 0) return null;
  var out = { desc: cleanText(x.desc, MAX_DESC_LEN), amount: round2(amount), kind: x.kind === "discount" ? "discount" : "charge" };
  var orig = Number(x.origAmount); if(isFinite(orig) && orig > 0) out.origAmount = round2(orig);
  var pct = Number(x.pct); if(isFinite(pct) && pct > 0) out.pct = pct;
  return out;
}

function rebuildState(){
  var peopleSnap = latestSnapshots.people;
  var billsSnap = latestSnapshots.bills;
  var settlementsSnap = latestSnapshots.settlements;
  var itinerarySnap = latestSnapshots.itinerary;
  var tripSnap = latestSnapshots.trip;
  if(!peopleSnap || !billsSnap || !settlementsSnap || !itinerarySnap || !tripSnap) return; // wait for all

  var settings = cloneSettings(DEFAULT_SETTINGS);
  var admins = null;   // null = no admin list yet
  tripSnap.forEach(function(doc){
    if(doc.id === "admins"){
      var em = doc.data().emails;
      admins = Array.isArray(em) ? em.filter(function(e){ return typeof e === "string"; }).map(normEmail) : [];
      return;
    }
    if(doc.id !== "settings") return;
    var d = doc.data();
    if(ymdToDate(d.startDate)) settings.startDate = d.startDate;
    if(ymdToDate(d.endDate) && d.endDate >= settings.startDate) settings.endDate = d.endDate;
    settings.airportRate = validRate(d.airportRate) ? Number(d.airportRate) : null;
    if(d.budget && typeof d.budget === "object"){
      CATEGORIES.forEach(function(c){
        if(!(c.id in d.budget)) return;   // keep the default for categories added later
        var v = Number(d.budget[c.id]);
        settings.budget[c.id] = (isFinite(v) && v >= 0) ? v : 0;
      });
    }
  });
  S.settings = settings;

  var people = [];
  peopleSnap.forEach(function(doc){
    var d = doc.data();
    people.push({
      email: doc.id,
      name: String(d.name||"").trim() || doc.id.split("@")[0],
      upi: String(d.upi||"").trim(),
      photo: String(d.photo||""),
      joinedAt: tsToIso(d.joinedAt)
    });
  });
  people.sort(function(a,b){ return String(a.joinedAt).localeCompare(String(b.joinedAt)); });

  var bills = [];
  billsSnap.forEach(function(doc){
    var d = doc.data({ serverTimestamps: "estimate" });
    if(d.deleted) return;
    var split = Array.isArray(d.split) ? d.split.map(normEmail).filter(function(e){return e!=="";}) : [];
    if(!split.length) return;
    var amount = Number(d.amount);
    if(!isFinite(amount) || amount<=0) return;
    bills.push({
      id: doc.id,
      createdAt: tsToIso(d.createdAt),
      desc: String(d.desc||""),
      amount: round2(amount),
      category: String(d.category||"other"),
      paidBy: normEmail(d.paidBy),
      split: split,
      splitMode: String(d.splitMode||"equal"),
      splitAmounts: d.splitAmounts || null,
      splitShares: d.splitShares || null,
      items: Array.isArray(d.items) ? d.items.map(cleanStoredItem).filter(Boolean) : null,
      extras: Array.isArray(d.extras) ? d.extras.map(cleanStoredExtra).filter(Boolean) : null,
      currency: d.currency === "LKR" ? "LKR" : "INR",
      origAmount: (d.currency === "LKR" && Number(d.origAmount) > 0) ? Number(d.origAmount) : null,
      fx: (d.currency === "LKR" && d.fx && validRate(d.fx.rate)) ? d.fx : null,
      billDate: ymdToDate(d.billDate) ? d.billDate : (tsToIso(d.createdAt) ? dateToYmd(new Date(tsToIso(d.createdAt))) : ""),
      addedBy: normEmail(d.addedBy)
    });
  });

  var settlements = [];
  settlementsSnap.forEach(function(doc){
    var d = doc.data({ serverTimestamps: "estimate" });
    if(d.deleted) return;
    var amount = Number(d.amount);
    if(!isFinite(amount) || amount<=0) return;
    settlements.push({
      id: doc.id,
      createdAt: tsToIso(d.createdAt),
      from: normEmail(d.from),
      to: normEmail(d.to),
      amount: round2(amount),
      markedBy: normEmail(d.markedBy)
    });
  });

  var itinerary = [];
  if(itinerarySnap.empty){
    // Nobody has synced the itinerary yet — fall back to the built-in seed
    // data so the app still works, and seed Firestore once so edits persist.
    itinerary = SEED_ITINERARY.slice();
    // Only members may write it, so wait until this person has joined.
    if(people.some(function(p){ return p.email === S.me; })) seedItineraryOnce();
  } else {
    itinerarySnap.forEach(function(doc){
      var d = doc.data();
      itinerary.push({
        day: Number(d.day)||0,
        date: String(d.date||""),
        weekday: String(d.weekday||""),
        stay: String(d.stay||""),
        title: String(d.title||""),
        items: itemsFromFirestore(d.items),
        tip: String(d.tip||"")
      });
    });
    itinerary.sort(function(a,b){ return a.day-b.day; });
  }
  // Day N's date is always start date + (N-1): changing the trip dates in
  // settings re-dates every day. Days past the end date are hidden, not
  // deleted, so shortening the trip by mistake loses nothing.
  var byDay = {};
  itinerary.forEach(function(d){ byDay[d.day] = d; });
  S.settings = settings;
  S.admins = admins || [];
  var dated = [];
  for(var dn=1; dn<=tripLength(); dn++){
    var base = byDay[dn] || { day:dn, title:"Day "+dn, stay:"", items:[], tip:"", placeholder:true };
    var dd = dayDate(dn);
    base.dateObj = dd;
    base.date = fmtDayMonth(dd);
    base.weekday = WEEKDAY_LONG[dd.getDay()];
    dated.push(base);
  }
  itinerary = dated;

  var joined = false;
  for(var i=0;i<people.length;i++) if(people[i].email===S.me){ joined = true; break; }

  S.people = people;
  S.bills = bills;
  S.settlements = settlements;
  S.itinerary = itinerary;
  S.joined = joined;
  S.fetchedAt = new Date().toISOString();

  setSync("ok");
  // The first member to open the app (the organiser) becomes the admin who
  // approves join requests. Rules only allow creating this list once.
  if(joined && admins === null) ensureAdmins();
  if(joined && isAdmin()) startRequestsListener(); else stopRequestsListener();
  if(!booted){
    if(!joined){
      // Only draw the join form once — later snapshots (other people adding
      // bills) must not wipe what this person is typing.
      if(!joinShown){ joinShown = true; showJoinScreen(); }
      return;
    }
    booted = true;
    buildShell();
    if(!passkeyOffered){
      passkeyOffered = true;
      setTimeout(function(){ if(booted && !openSheetEl) offerPasskeySetup(S.me); }, 900);
    }
  }
  render();
}

/** Firestore doesn't support nested arrays, so [["2:30 PM","Temple..."], ...]
    is stored as [{t:"2:30 PM", x:"Temple..."}, ...] and converted back to
    tuples wherever the rest of the app expects the tuple shape. */
function itemsToFirestore(items){
  return items.map(function(it){ return { t: it[0]||"", x: it[1]||"" }; });
}
function itemsFromFirestore(items){
  if(!Array.isArray(items)) return [];
  return items.map(function(it){
    if(Array.isArray(it)) return [String(it[0]||""), String(it[1]||"")]; // legacy shape, just in case
    return [String((it&&it.t)||""), String((it&&it.x)||"")];
  });
}

/* ---- Join requests ----
   New people sign in with Google and send a join request (requests/{email}).
   An admin approves it, which creates their people/{email} doc — only then
   can they read or write anything. Rules enforce all of this. */
var ORGANISER_EMAIL = "harshithhb17@gmail.com";
var adminsCreating = false;
function isAdmin(){ return (S.admins || []).indexOf(S.me) >= 0; }
function ensureAdmins(){
  if(adminsCreating) return;
  adminsCreating = true;
  db.collection("trip").doc("admins").set({ emails: [S.me] })
    .catch(function(err){ console.warn("Couldn't create admin list:", err && err.code); });
}
function appLink(){ return location.origin + location.pathname; }

function startRequestsListener(){
  if(unsubRequests) return;
  unsubRequests = db.collection("requests").onSnapshot(function(snap){
    var list = [];
    snap.forEach(function(doc){
      var d = doc.data({ serverTimestamps:"estimate" });
      list.push({ email: doc.id, name: cleanText(d.name, MAX_NAME_LEN) || doc.id.split("@")[0],
                  upi: cleanText(d.upi, MAX_UPI_LEN), photo: typeof d.photo === "string" ? d.photo : "",
                  at: tsToIso(d.requestedAt) });
    });
    list.sort(function(a,b){ return String(a.at).localeCompare(String(b.at)); });
    S.requests = list;
    if(booted){ render(); updateRequestBadge(); }
  }, function(err){ console.warn("requests listener:", err && err.code); S.requests = []; unsubRequests = null; });
}
function stopRequestsListener(){
  if(unsubRequests){ unsubRequests(); unsubRequests = null; }
  S.requests = [];
}
function updateRequestBadge(){
  var btn = document.querySelector('.tab-btn[data-tab="balances"]');
  if(!btn) return;
  var n = (S.requests || []).length, badge = btn.querySelector(".tab-badge");
  if(n && !badge){ badge = document.createElement("span"); badge.className = "tab-badge"; btn.appendChild(badge); }
  if(badge){ if(n) badge.textContent = n; else badge.remove(); }
}

function requestsCardHtml(){
  var reqs = S.requests || [];
  if(!isAdmin() || !reqs.length) return "";
  return '<div class="card req-card"><div class="now-hero-lbl" style="margin-bottom:8px;">'+
      reqs.length+' '+(reqs.length === 1 ? 'person wants' : 'people want')+' to join</div>'+
    reqs.map(function(r){
      return '<div class="req-row">'+
        (r.photo ? '<div class="avatar"><img src="'+esc(r.photo)+'" alt=""></div>' : '<div class="avatar">'+esc(r.name.charAt(0).toUpperCase())+'</div>')+
        '<div class="p-name">'+esc(r.name)+'<div class="p-sub">'+esc(r.email)+'</div></div>'+
        '<button class="btn btn-line btn-sm" data-action="decline-req" data-id="'+esc(r.email)+'">Decline</button>'+
        '<button class="btn btn-brand btn-sm" data-action="approve-req" data-id="'+esc(r.email)+'">Approve</button>'+
      '</div>';
    }).join("")+'</div>';
}

function approveRequest(email){
  var r = (S.requests || []).filter(function(x){ return x.email === email; })[0];
  if(!r) return Promise.reject(new Error("That request is gone."));
  var batch = db.batch();
  batch.set(db.collection("people").doc(docId(email)), {
    name: r.name, upi: r.upi, photo: r.photo,
    joinedAt: firebase.firestore.FieldValue.serverTimestamp(), approvedBy: S.me
  });
  batch.delete(db.collection("requests").doc(docId(email)));
  return batch.commit();
}
function declineRequest(email){
  return db.collection("requests").doc(docId(email)).delete();
}

function stopJoinWatch(){
  if(unsubMyPerson){ unsubMyPerson(); unsubMyPerson = null; }
  if(unsubMyRequest){ unsubMyRequest(); unsubMyRequest = null; }
}

function restartListeners(){
  stopJoinWatch();
  [unsubPeople, unsubBills, unsubSettlements, unsubItinerary, unsubTrip].forEach(function(u){ if(u) u(); });
  unsubPeople = unsubBills = unsubSettlements = unsubItinerary = unsubTrip = null;
  latestSnapshots = { people:null, bills:null, settlements:null, itinerary:null, trip:null };
  joinShown = false;
  showBootLoading();
  startListeners();
}

function seedItineraryOnce(){
  if(itinerarySeeded) return;
  itinerarySeeded = true;
  var batch = db.batch();
  SEED_ITINERARY.forEach(function(d){
    var ref = db.collection("itinerary").doc("day" + d.day);
    batch.set(ref, {
      day: d.day, date: d.date, weekday: d.weekday, stay: d.stay,
      title: d.title, items: itemsToFirestore(d.items), tip: d.tip||""
    }, { merge:true });
  });
  batch.commit().catch(function(err){
    console.warn("Itinerary seed failed, will retry:", err && err.code);
    itinerarySeeded = false;   // try again on the next snapshot (e.g. after joining)
  });
}

function startListeners(){
  if(unsubPeople) return;   // already listening
  unsubPeople = db.collection("people").onSnapshot(function(snap){
    latestSnapshots.people = snap;
    rebuildState();
  }, function(err){ serverFail(err); });

  unsubBills = db.collection("bills").onSnapshot(function(snap){
    latestSnapshots.bills = snap;
    rebuildState();
  }, function(err){ serverFail(err); });

  unsubSettlements = db.collection("settlements").onSnapshot(function(snap){
    latestSnapshots.settlements = snap;
    rebuildState();
  }, function(err){ serverFail(err); });

  unsubItinerary = db.collection("itinerary").onSnapshot(function(snap){
    latestSnapshots.itinerary = snap;
    rebuildState();
  }, function(err){ serverFail(err); });

  unsubTrip = db.collection("trip").onSnapshot(function(snap){
    latestSnapshots.trip = snap;
    rebuildState();
  }, function(err){ serverFail(err); });
}

function serverFail(err){
  if(!booted && err && err.code === "permission-denied"){
    if(!joinShown){ joinShown = true; showJoinScreen(); }
    return;
  }
  setSync("err");
  var msg = (err && err.message) ? err.message : "Couldn't reach the trip database.";
  if(!booted){
    var sp = document.getElementById("boot-spinner");
    if(sp) sp.style.display = "none";
    var bm = document.getElementById("boot-msg");
    if(bm) bm.textContent = msg;
    var be = document.getElementById("boot-extra");
    if(be) be.innerHTML = '<button class="btn btn-brand" style="margin-top:16px" onclick="location.reload()">Try again</button>';
  } else {
    toast(msg, true);
  }
}

/** Turns Firestore error codes into something a person can act on. */
function friendlyError(err){
  var code = err && err.code;
  if(code === "permission-denied") return "You don't have permission to change that — only the person who added it can.";
  if(code === "unavailable") return "Can't reach the server — your change is saved on this phone and will sync.";
  return (err && err.message) ? err.message : "Something went wrong — try again.";
}

/** Run a write, close the sheet, and toast.
    Firestore applies writes locally straight away and the rest of the app
    re-renders from that, but the promise only settles once the SERVER
    confirms — on hill-country signal that can take ages even while the phone
    claims to be online. So: if the server hasn't answered in 1.2s, close the
    sheet anyway and say it'll sync. Validation mistakes reject instantly, so
    those keep the sheet open for fixing. Only closes the sheet this write
    came from, never one the person opened afterwards. */
function writeOp(promise, okMsg, btn){
  var sheetAtStart = openSheetEl;
  var settled = false, deferred = false;
  if(btn) btn.disabled = true;
  setSync("busy");
  pendingWrites++;
  updateOfflineBanner();

  function closeOwnSheet(){ if(sheetAtStart && openSheetEl === sheetAtStart) closeSheet(); }

  var timer = setTimeout(function(){
    if(settled) return;
    deferred = true;
    if(btn) btn.disabled = false;
    closeOwnSheet();
    toast((okMsg || "Saved") + " · will sync when signal is back");
  }, 1200);

  promise.then(function(){
    settled = true; clearTimeout(timer);
    if(btn) btn.disabled = false;
    pendingWrites = Math.max(0, pendingWrites-1);
    setSync(pendingWrites > 0 ? "busy" : "ok");
    updateOfflineBanner();
    if(!deferred){ closeOwnSheet(); if(okMsg) toast(okMsg); }
    else if(pendingWrites === 0) toast("All changes synced ✓");
  }, function(err){
    settled = true; clearTimeout(timer);
    if(btn) btn.disabled = false;
    pendingWrites = Math.max(0, pendingWrites-1);
    updateOfflineBanner();
    if(err && err.code){           // came back from Firestore
      setSync("err");
      toast(friendlyError(err), true);
    } else {                       // our own validation message
      setSync("ok");
      toast(err && err.message ? err.message : "Check the details and try again", true);
    }
  });
}

function requireMember(){
  var found = false;
  for(var i=0;i<S.people.length;i++) if(S.people[i].email===S.me){ found=true; break; }
  if(!found) throw new Error("Join the trip first, then add bills.");
}

/* ---- Write actions (replace google.script.run calls) ---- */

function requestToJoin(name, upi){
  var cleanName = cleanText(name, MAX_NAME_LEN);
  if(!cleanName) return Promise.reject(new Error("Add your name so the group knows who you are."));
  // The organiser is the first member of a brand-new group — nobody exists yet to approve them.
  if(S.me === ORGANISER_EMAIL){
    return db.collection("people").doc(docId(S.me)).set({
      name: cleanName, upi: cleanText(upi, MAX_UPI_LEN), photo: S.myPhoto || "",
      joinedAt: firebase.firestore.FieldValue.serverTimestamp(), approvedBy: S.me
    });
  }
  return db.collection("requests").doc(docId(S.me)).set({
    name: cleanName, upi: cleanText(upi, MAX_UPI_LEN), photo: S.myPhoto || "",
    requestedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

/** Edits name/UPI only — leaves joinedAt alone so the member order is stable. */
function updateProfile(name, upi){
  var cleanName = cleanText(name, MAX_NAME_LEN);
  if(!cleanName) return Promise.reject(new Error("Name can't be empty."));
  return db.collection("people").doc(docId(S.me)).set({
    name: cleanName, upi: cleanText(upi, MAX_UPI_LEN), photo: S.myPhoto || ""
  }, { merge:true });
}

function addBill(payload){
  try{
    requireMember();
    var peopleEmails = S.people.map(function(p){ return p.email; });
    var bill = validateBill(payload, peopleEmails);
    var id = newId("b");
    return db.collection("bills").doc(id).set({
      desc: bill.desc, amount: bill.amount, category: bill.category,
      paidBy: bill.paidBy, split: bill.split, addedBy: S.me,
      splitMode: bill.splitMode,
      splitAmounts: bill.splitAmounts || null,
      splitShares: bill.splitShares || null,
      items: bill.items || null,
      extras: bill.extras && bill.extras.length ? bill.extras : null,
      currency: bill.currency, origAmount: bill.origAmount, fx: bill.fx, billDate: bill.billDate,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      deleted: false
    });
  } catch(e){ return Promise.reject(e); }
}

function updateBill(id, payload){
  try{
    requireMember();
    var peopleEmails = S.people.map(function(p){ return p.email; });
    var bill = validateBill(payload, peopleEmails);
    return db.collection("bills").doc(id).update({
      desc: bill.desc, amount: bill.amount, category: bill.category,
      paidBy: bill.paidBy, split: bill.split,
      splitMode: bill.splitMode,
      splitAmounts: bill.splitAmounts || null,
      splitShares: bill.splitShares || null,
      items: bill.items || null,
      extras: bill.extras && bill.extras.length ? bill.extras : null,
      currency: bill.currency, origAmount: bill.origAmount, fx: bill.fx, billDate: bill.billDate,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch(e){ return Promise.reject(e); }
}

function deleteBill(id){
  try{
    requireMember();
    return db.collection("bills").doc(id).update({
      deleted: true, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch(e){ return Promise.reject(e); }
}

function addSettlement(fromEmail, toEmail, amount){
  try{
    requireMember();
    var peopleEmails = S.people.map(function(p){ return p.email; });
    var from = normEmail(fromEmail), to = normEmail(toEmail), amt = round2(amount);
    if(peopleEmails.indexOf(from)===-1 || peopleEmails.indexOf(to)===-1)
      throw new Error("Both people need to have joined the trip.");
    if(from===to) throw new Error("A payment needs two different people.");
    if(!isFinite(amt) || amt<=0) throw new Error("Enter an amount greater than zero.");
    if(amt > MAX_AMOUNT) throw new Error("That amount looks too large — check the digits.");
    var id = newId("s");
    return db.collection("settlements").doc(id).set({
      from: from, to: to, amount: amt, markedBy: S.me,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      deleted: false
    });
  } catch(e){ return Promise.reject(e); }
}

function deleteSettlement(id){
  try{
    requireMember();
    return db.collection("settlements").doc(id).update({ deleted:true });
  } catch(e){ return Promise.reject(e); }
}

var MAX_ITEM_LEN = 90, MAX_TITLE_LEN = 60, MAX_STAY_LEN = 40, MAX_TIP_LEN = 140;

function updateItinerary(day, payload){
  try{
    requireMember();
    var title = cleanText(payload.title, MAX_TITLE_LEN);
    var stay = cleanText(payload.stay, MAX_STAY_LEN);
    var tip = cleanText(payload.tip, MAX_TIP_LEN);
    var items = (payload.items||[]).map(function(it){
      return [cleanText(it[0],20), cleanText(it[1], MAX_ITEM_LEN)];
    }).filter(function(it){ return it[1]; });
    if(!title) throw new Error("Give this day a title.");
    if(items.length > 30) throw new Error("That's a lot for one day — keep it to 30 items or fewer.");
    return db.collection("itinerary").doc("day"+day).set({
      day: day, title: title, stay: stay, tip: tip, items: itemsToFirestore(items),
      updatedBy: S.me, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge:true });
  } catch(e){ return Promise.reject(e); }
}

/* ====================== Shell ====================== */

function buildShell(){
  document.getElementById("app").innerHTML =
    '<header class="topbar">'+
      '<div class="topbar-row"><h1 class="trip-title"><img class="logo-sm" src="icon-192.png" alt="">Wicket Keepers</h1>'+
      '<button class="hdr-gear" data-action="trip-settings" aria-label="Trip settings" title="Trip settings">⚙️</button></div>'+
      '<div class="route-line">Colombo Airport → Kandy → Nuwara Eliya → Ella → Mirissa → Galle → Colombo</div>'+
      '<div class="whoami">'+
        '<span class="me"><span class="sync-dot" id="sync-dot"></span><span id="me-label"></span></span>'+
        '<button id="btn-profile">Edit</button>'+
      '</div>'+
    '</header>'+
    '<div class="offline-banner" id="offline-banner"><span class="ob-text"></span></div>'+
    '<main id="view"></main>'+
    '<button class="fab" id="fab" aria-label="Add a bill">+</button>'+
    '<nav class="tabbar" id="tabbar">'+
      '<button class="tab-btn" data-tab="now"><span class="ic">📍</span>Now</button>'+
      '<button class="tab-btn" data-tab="itinerary"><span class="ic">🗓️</span>Plan</button>'+
      '<button class="tab-btn" data-tab="balances"><span class="ic">⚖️</span>Balances</button>'+
      '<button class="tab-btn" data-tab="bills"><span class="ic">🧾</span>Bills</button>'+
      '<button class="tab-btn" data-tab="settle"><span class="ic">🤝</span>Settle</button>'+
    '</nav>';

  document.getElementById("tabbar").addEventListener("click", function(e){
    var b = e.target.closest(".tab-btn");
    if(b) setTab(b.dataset.tab);
  });
  document.getElementById("fab").addEventListener("click", function(){ openBillSheet(null); });
  document.getElementById("btn-profile").addEventListener("click", function(){ openProfileSheet(); });

  updateOfflineBanner();
  setTab(activeTab);

  // Keep the "Now" view fresh even if nobody touches the app — re-render
  // every minute so "up next" and the countdown stay accurate.
  if(nowTimer) clearInterval(nowTimer);
  nowTimer = setInterval(function(){ if(booted && activeTab==="now") render(); }, 60000);
}

function setTab(tab){
  activeTab = tab;
  var btns = document.querySelectorAll(".tab-btn");
  for(var i=0;i<btns.length;i++) btns[i].classList.toggle("active", btns[i].dataset.tab===tab);
  var fab = document.getElementById("fab");
  if(fab) fab.style.display = (tab==="itinerary" || tab==="now") ? "none" : "block";
  render();
  var v = document.getElementById("view");
  if(v) v.scrollTop = 0;
}

function render(){
  if(!booted) return;
  var me = person(S.me);
  document.getElementById("me-label").textContent = me.name + (me.upi ? " · " + me.upi : "");

  var v = document.getElementById("view");
  if(activeTab==="now") v.innerHTML = requestsCardHtml() + viewNow();
  else if(activeTab==="itinerary") v.innerHTML = viewItinerary();
  else if(activeTab==="balances") v.innerHTML = requestsCardHtml() + viewBalances();
  else if(activeTab==="bills") v.innerHTML = viewBills();
  else v.innerHTML = viewSettle();
  updateRequestBadge();
}

/* ====================== Views ====================== */

function budgetChipHtml(){
  var b = budgetSummary();
  return '<div class="now-chip" data-action="goto-plan" style="cursor:pointer;"><div class="nc-k">Trip spend</div>'+
    '<div class="nc-v'+(b.budget>0 && b.spent>b.budget?' neg':'')+'">'+inrWhole(b.spent)+'<span class="muted" style="font-size:12px;font-weight:500;"> / '+inrWhole(b.budget)+'</span></div>'+
    barHtml(b.spent, b.budget)+'</div>';
}

function viewNow(){
  var now = new Date();
  var days = S.itinerary.slice().sort(function(a,b){ return a.day-b.day; });
  if(!days.length) return '<div class="empty"><span class="big">🗓️</span>No itinerary yet</div>';

  var dated = days.map(function(d){ return { d:d, date: d.dateObj }; }).filter(function(x){ return x.date; });
  var tripStart = dated.length ? dated[0].date : null;
  var tripEnd = dated.length ? new Date(dated[dated.length-1].date.getTime() + 24*3600*1000) : null;

  var bal = computeBalances();
  var mine = bal[S.me] || 0;
  var balChip = Math.abs(mine)<0.005
    ? '<div class="now-chip"><div class="nc-k">Balance</div><div class="nc-v pos">All square</div></div>'
    : (mine>0
      ? '<div class="now-chip"><div class="nc-k">You\'re owed</div><div class="nc-v pos">'+inr(mine)+'</div></div>'
      : '<div class="now-chip"><div class="nc-k">You owe</div><div class="nc-v neg">'+inr(-mine)+'</div></div>');

  // Not started yet — countdown hero.
  if(!tripStart || now < tripStart){
    var msLeft = tripStart ? (tripStart - now) : 0;
    var daysLeft = Math.ceil(msLeft / (24*3600*1000));
    return '<div class="card now-hero">'+
        '<div class="now-hero-lbl">Trip starts in</div>'+
        '<div class="now-hero-big">'+(tripStart? daysLeft : "?")+'<span class="now-hero-unit">'+(daysLeft===1?" day":" days")+'</span></div>'+
        '<div class="now-hero-sub">'+esc(days[0].title)+' · '+esc(days[0].weekday+" "+days[0].date)+'</div>'+
      '</div>'+
      '<div class="now-chips">'+balChip+budgetChipHtml()+
        '<div class="now-chip"><div class="nc-k">People joined</div><div class="nc-v">'+S.people.length+'</div></div>'+
      '</div>'+
      '<div class="section-label">First up</div>'+
      '<div class="card">'+days[0].items.slice(0,4).map(function(it){
        return '<div class="item-row"><div class="item-time">'+esc(it[0])+'</div><div class="item-text">'+esc(it[1])+'</div>'+mapsBtnHtml(it[1])+'</div>';
      }).join("")+'</div>';
  }

  // Trip finished.
  if(tripEnd && now >= tripEnd){
    var total = S.bills.reduce(function(s,b){ return s+b.amount; }, 0);
    return '<div class="card now-hero">'+
        '<div class="now-hero-lbl">🎉 Trip complete</div>'+
        '<div class="now-hero-sub">'+inr(total)+' logged across '+S.bills.length+' bill'+(S.bills.length===1?"":"s")+'</div>'+
      '</div>'+
      '<div class="now-chips">'+balChip+budgetChipHtml()+'</div>'+
      '<div class="muted" style="font-size:12.5px;padding:10px 2px;">Head to Settle to clear any last balances.</div>';
  }

  // Mid-trip — find today's day card by matching calendar date.
  var todayEntry = dated.filter(function(x){
    return x.date.getFullYear()===now.getFullYear() && x.date.getMonth()===now.getMonth() && x.date.getDate()===now.getDate();
  })[0];

  if(!todayEntry){
    // Between listed days (shouldn't normally happen) — show nearest upcoming.
    var upcoming = dated.filter(function(x){ return x.date > now; })[0] || dated[dated.length-1];
    return '<div class="card now-hero"><div class="now-hero-lbl">On the road</div>'+
      '<div class="now-hero-sub">Next: '+esc(upcoming.d.title)+'</div></div>'+
      '<div class="now-chips">'+balChip+budgetChipHtml()+'</div>';
  }

  var d = todayEntry.d, baseDate = todayEntry.date;
  var itemsWithTime = d.items.map(function(it){ return { it:it, t: parseItemTime(baseDate, it[0]) }; });
  var nextItem = itemsWithTime.filter(function(x){ return x.t && x.t > now; })[0];
  var pastCount = itemsWithTime.filter(function(x){ return x.t && x.t <= now; }).length;

  var upNext = nextItem
    ? '<div class="now-hero-lbl">Up next</div><div class="now-hero-sub" style="font-size:17px;font-weight:600;">'+esc(nextItem.it[1])+mapsBtnHtml(nextItem.it[1],"margin-left:6px;")+'</div><div class="now-hero-time">'+esc(nextItem.it[0])+'</div>'
    : '<div class="now-hero-lbl">Today</div><div class="now-hero-sub" style="font-size:17px;font-weight:600;">'+esc(d.title)+'</div>';

  var todaysLegs = DRIVE_LEGS.filter(function(l){ return l[2] === d.day; });
  var nextLeg = DRIVE_LEGS.filter(function(l){ return l[2] > d.day; })[0];
  var legChip = todaysLegs.length
    ? '<div class="now-chip"><div class="nc-k">Today\'s drive</div><div class="nc-v" style="font-size:13.5px;">'+
        todaysLegs.map(function(l){ return esc(l[0])+' · '+esc(l[1]); }).join('<br>')+'</div></div>'
    : (nextLeg
      ? '<div class="now-chip"><div class="nc-k">No driving today · next (Day '+nextLeg[2]+')</div><div class="nc-v" style="font-size:13.5px;">'+esc(nextLeg[0])+' · '+esc(nextLeg[1])+'</div></div>'
      : '');

  var restOfDay = itemsWithTime.map(function(x, i){
    var done = x.t && x.t <= now;
    var isNext = nextItem && x.it===nextItem.it;
    return '<div class="item-row'+(done?" now-done":"")+(isNext?" now-next":"")+'"><div class="item-time">'+esc(x.it[0])+'</div>'+
      '<div class="item-text">'+esc(x.it[1])+(isNext?' <span class="now-badge">NEXT</span>':'')+'</div>'+mapsBtnHtml(x.it[1])+'</div>';
  }).join("");

  return '<div class="card now-hero">'+upNext+
      '<div class="now-hero-foot">Day '+d.day+' of '+days.length+' · Staying in '+esc(d.stay)+'</div>'+
    '</div>'+
    '<div class="now-chips">'+balChip+legChip+'</div><div class="now-chips">'+budgetChipHtml()+'</div>'+
    '<div class="section-label">Today\'s schedule</div>'+
    '<div class="card">'+restOfDay+'</div>'+
    (d.tip ? '<div class="day-tip" style="margin:10px 2px;">📝 '+esc(d.tip)+'</div>' : '');
}

function viewItinerary(){
  var legs = DRIVE_LEGS.map(function(l){
    return '<div class="ref-chip"><div class="k">'+esc(l[0])+'</div><div class="v">'+esc(l[1])+'</div></div>';
  }).join("");
  var days = S.itinerary.map(function(d){
    var items = d.items.map(function(it){
      return '<div class="item-row"><div class="item-time">'+esc(it[0])+'</div>'+
             '<div class="item-text">'+esc(it[1])+'</div>'+
             mapsBtnHtml(it[1])+'</div>';
    }).join("");
    var tip = d.tip ? '<div class="day-tip">📝 '+esc(d.tip)+'</div>' : "";
    var editBtn = '<button class="btn btn-ghost btn-sm" data-action="edit-day" data-day="'+d.day+'" style="margin-top:10px;">✏️ Edit this day</button>';
    var stayPin = mapsBtnHtml(d.stay, "margin-left:6px;");
    return '<div class="day-card'+(d.day===openDay?" open":"")+'">'+
      '<button class="day-head" data-action="toggle-day" data-day="'+d.day+'">'+
        '<div class="day-num">'+d.day+'</div>'+
        '<div class="day-meta"><div class="d1">'+esc(d.title)+'</div>'+
        '<div class="d2">'+esc(d.weekday+" "+d.date)+(d.stay ? ' · Stay: '+esc(d.stay)+stayPin : '')+'</div></div>'+
        '<div class="day-chev">⌄</div></button>'+
      '<div class="day-body"><div class="day-body-in">'+items+tip+editBtn+'</div></div></div>';
  }).join("");

  return '<div class="plan-top">'+
           '<div><div class="plan-dates">'+esc(tripRangeLabel())+' · '+S.itinerary.length+' day'+(S.itinerary.length===1?'':'s')+'</div>'+
           '<div class="muted" style="font-size:12px;">Dates, budget and airport rate live in Trip settings</div></div>'+
           '<button class="btn btn-ghost btn-sm" data-action="trip-settings">⚙️ Trip settings</button>'+
         '</div>'+
         viewBudgetCard()+
         '<div class="section-label">Drive times</div><div class="ref-scroller">'+legs+'</div>'+
         '<div class="section-label">Day by day</div>'+days;
}

/* ---- Live budget ---- */

function spendByCategory(){
  var m = {};
  CATEGORIES.forEach(function(c){ m[c.id] = 0; });
  S.bills.forEach(function(b){
    var k = m.hasOwnProperty(b.category) ? b.category : "other";
    m[k] = round2(m[k] + b.amount);
  });
  return m;
}

function budgetSummary(){
  var sp = spendByCategory(), bud = S.settings.budget || {};
  var spent = 0, budget = 0;
  CATEGORIES.forEach(function(c){ spent += sp[c.id]; budget += Number(bud[c.id]) || 0; });
  var mine = 0;
  S.bills.forEach(function(b){ mine += Number(billShares(b)[S.me]) || 0; });
  return { byCat: sp, spent: round2(spent), budget: round2(budget), mine: round2(mine) };
}

function barHtml(spent, budget){
  var pct = budget > 0 ? Math.min(100, spent / budget * 100) : (spent > 0 ? 100 : 0);
  var over = budget > 0 ? spent > budget : spent > 0;
  return '<div class="bbar"><div class="bfill'+(over ? ' over' : '')+'" style="width:'+pct.toFixed(1)+'%"></div></div>';
}

function viewBudgetCard(){
  var b = budgetSummary(), bud = S.settings.budget || {};
  var left = round2(b.budget - b.spent);
  var n = Math.max(1, S.people.length);
  var rows = CATEGORIES.filter(function(c){ return (Number(bud[c.id]) || 0) > 0 || b.byCat[c.id] > 0; }).map(function(c){
    var cb = Number(bud[c.id]) || 0, cs = b.byCat[c.id];
    return '<div class="bud-row"><div class="bud-top"><span>'+c.icon+' '+esc(c.label)+'</span>'+
      '<span class="'+(cb > 0 && cs > cb ? 'neg' : 'muted')+'">'+inrWhole(cs)+(cb > 0 ? ' / '+inrWhole(cb) : ' · no budget')+'</span></div>'+
      barHtml(cs, cb)+'</div>';
  }).join("");
  return '<div class="card bud-card">'+
    '<div class="bud-hero"><div><div class="now-hero-lbl">Trip budget</div>'+
      '<div class="bud-big">'+inrWhole(b.spent)+' <span class="muted" style="font-size:14px;font-weight:500;">of '+inrWhole(b.budget)+'</span></div></div>'+
      '<div class="bud-left '+(left < 0 ? 'neg' : 'pos')+'">'+(left < 0 ? inrWhole(-left)+'<br><span>over</span>' : inrWhole(left)+'<br><span>left</span>')+'</div></div>'+
    barHtml(b.spent, b.budget)+
    '<div class="muted" style="font-size:12px;margin:8px 0 10px;">'+inrWhole(b.spent / n)+' per person so far · your share '+inrWhole(b.mine)+'</div>'+
    rows+
    '<button class="btn btn-ghost btn-sm" data-action="trip-settings" style="margin-top:10px;">Edit budget</button>'+
  '</div>';
}

/* ---- Trip settings sheet: dates, airport rate, budget ---- */

function saveTripSettings(data){
  try{
    requireMember();
    var a = ymdToDate(data.startDate), b = ymdToDate(data.endDate);
    if(!a || !b) throw new Error("Pick both a start and an end date.");
    if(b < a) throw new Error("The trip can't end before it starts.");
    if(Math.round((b - a) / 86400000) + 1 > 30) throw new Error("Keep the trip to 30 days or fewer.");
    if(data.airportRate != null && !validRate(data.airportRate)) throw new Error("Airport rate should be the LKR you get for ₹1 — something like 3.4.");
    return db.collection("trip").doc("settings").set({
      startDate: data.startDate,
      endDate: data.endDate,
      airportRate: data.airportRate == null ? null : Math.round(Number(data.airportRate) * 10000) / 10000,
      budget: data.budget,
      updatedBy: S.me,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge:true });
  } catch(e){ return Promise.reject(e); }
}

function openTripSettingsSheet(){
  var st = S.settings, bud = st.budget || {};
  var budRows = CATEGORIES.map(function(c){
    return '<div class="split-row"><span style="flex:1;font-size:13.5px;">'+c.icon+' '+esc(c.label)+'</span>'+
      '<div class="amount-field" style="width:130px;"><span class="rupee">₹</span>'+
      '<input type="number" inputmode="numeric" class="split-input" data-role="bud" data-id="'+c.id+'" style="width:100%;padding-left:24px;" value="'+(Number(bud[c.id]) || "")+'" placeholder="0"></div></div>';
  }).join("");

  openSheetHtml(
    '<h3>Trip settings</h3>'+
    '<div class="field"><label>Invite friends</label>'+
      '<div class="invite-box"><div class="muted" style="font-size:13px;">They open the link, sign in with Google and ask to join. '+
        (isAdmin() ? 'You approve them.' : 'The organiser approves them.')+'</div>'+
        '<button class="btn btn-brand btn-sm" id="ts-share" style="flex:0 0 auto;">Share link</button></div></div>'+
    '<div style="display:flex;gap:10px;">'+
      '<div class="field" style="flex:1;"><label>Trip starts</label><input type="date" id="ts-start" value="'+esc(st.startDate)+'"></div>'+
      '<div class="field" style="flex:1;"><label>Trip ends</label><input type="date" id="ts-end" value="'+esc(st.endDate)+'"></div>'+
    '</div>'+
    '<div class="split-hint" id="ts-len" style="margin:-6px 0 14px;"></div>'+
    '<div class="field"><label>Airport exchange rate</label>'+
      '<div class="fx-line">₹1 = <input type="number" inputmode="decimal" step="0.01" id="ts-rate" class="split-input" style="width:90px;" value="'+(st.airportRate || "")+'" placeholder="e.g. 3.40"> LKR</div>'+
      '<div class="split-hint" id="ts-market">Checking today\'s market rate…</div></div>'+
    '<div class="field"><label>Budget (whole group, in ₹)</label>'+budRows+
      '<div class="split-hint" id="ts-budtotal"></div></div>'+
    '<div class="sheet-actions"><button class="btn btn-brand" id="ts-save">Save</button></div>',
    function(el){
      var startIn = el.querySelector("#ts-start"), endIn = el.querySelector("#ts-end");

      el.querySelector("#ts-share").addEventListener("click", function(){
        var link = appLink(), text = "Join our trip on Wicket Keepers — open the link, sign in with Google and tap Ask to join.";
        if(navigator.share){
          navigator.share({ title:"Wicket Keepers", text:text, url:link }).catch(function(){});
        } else if(navigator.clipboard){
          navigator.clipboard.writeText(text+"\n"+link).then(function(){ toast("Link copied"); }, function(){ toast(link); });
        } else toast(link);
      });

      function lenHint(){
        var a = ymdToDate(startIn.value), b = ymdToDate(endIn.value);
        var h = el.querySelector("#ts-len");
        if(!a || !b){ h.textContent = ""; return; }
        var n = Math.round((b - a) / 86400000) + 1;
        if(n < 1){ h.textContent = "The end date is before the start date."; return; }
        var maxPlanned = 0;
        S.itinerary.forEach(function(d){ if(!d.placeholder) maxPlanned = Math.max(maxPlanned, d.day); });
        var extra = "";
        if(n < maxPlanned) extra = " · Days "+(n + 1)+"–"+maxPlanned+" will be hidden (not deleted) — extend again to bring them back.";
        else if(n > S.itinerary.length) extra = " · Adds "+(n - S.itinerary.length)+" empty day"+(n - S.itinerary.length === 1 ? "" : "s")+" to plan.";
        h.textContent = n+" day"+(n === 1 ? "" : "s")+" · "+WEEKDAY_LONG[a.getDay()]+" "+fmtDayMonth(a)+" → "+WEEKDAY_LONG[b.getDay()]+" "+fmtDayMonth(b)+extra;
      }

      function budTotal(){
        var t = 0;
        el.querySelectorAll('[data-role="bud"]').forEach(function(i){ t += Number(i.value) || 0; });
        el.querySelector("#ts-budtotal").textContent = "Total "+inr(t)+" · "+inr(t / Math.max(1, S.people.length))+" per person";
      }

      // Moving the start date shifts the whole trip, keeping its length.
      var lastStart = ymdToDate(startIn.value);
      startIn.addEventListener("change", function(){
        var a = ymdToDate(startIn.value), b = ymdToDate(endIn.value);
        if(a && b && lastStart){
          var len = Math.round((b - lastStart) / 86400000);
          endIn.value = dateToYmd(addDays(a, Math.max(0, len)));
        }
        if(a) lastStart = a;
        lenHint();
      });
      endIn.addEventListener("change", lenHint);
      el.querySelectorAll('[data-role="bud"]').forEach(function(i){ i.addEventListener("input", budTotal); });
      lenHint();
      budTotal();

      fetchLkrPerInr(todayYmd()).then(function(r){
        var m = el.querySelector("#ts-market");
        if(!m) return;
        m.innerHTML = "Today's market rate: ₹1 = "+r.rate+" LKR. Airport counters usually give a little less. "+
          '<a href="#" id="ts-use-market">Use this</a>';
        el.querySelector("#ts-use-market").addEventListener("click", function(e){
          e.preventDefault();
          el.querySelector("#ts-rate").value = r.rate;
        });
      }).catch(function(){
        var m = el.querySelector("#ts-market");
        if(m) m.textContent = "Enter the rate from your airport exchange receipt (LKR you got for ₹1).";
      });

      el.querySelector("#ts-save").addEventListener("click", function(){
        var budget = {};
        el.querySelectorAll('[data-role="bud"]').forEach(function(i){
          budget[i.dataset.id] = Math.max(0, Math.round(Number(i.value) || 0));
        });
        var rateVal = el.querySelector("#ts-rate").value.trim();
        writeOp(saveTripSettings({
          startDate: startIn.value,
          endDate: endIn.value,
          airportRate: rateVal === "" ? null : Number(rateVal),
          budget: budget
        }), "Trip settings saved", this);
      });
    }
  );
}


function viewBalances(){
  var bal = computeBalances();
  var mine = bal[S.me] || 0;
  var heroAmt, heroLbl;
  if(mine > 0.005){ heroAmt = '<span class="pos">'+inr(mine)+'</span>'; heroLbl = "you're owed overall"; }
  else if(mine < -0.005){ heroAmt = '<span class="neg">'+inr(-mine)+'</span>'; heroLbl = "you owe overall"; }
  else { heroAmt = '<span class="pos">₹0</span>'; heroLbl = "you're all square"; }

  var rows = S.people.map(function(p){
    var v = bal[p.email] || 0;
    var cls = v>0.005 ? "pos" : (v<-0.005 ? "neg" : "");
    var sub = v>0.005 ? "is owed" : (v<-0.005 ? "owes the group" : "all settled");
    return '<div class="person-row">'+
      avatarHtml(p.email)+
      '<div class="p-name">'+esc(p.name)+(p.email===S.me?'<span class="you-tag">YOU</span>':'')+
      '<div class="p-sub">'+sub+'</div></div>'+
      '<div class="p-amt '+cls+'">'+(Math.abs(v)<0.005?"—":inr(Math.abs(v)))+'</div></div>';
  }).join("");

  var total = S.bills.reduce(function(s,b){ return s+b.amount; }, 0);

  return '<div class="card balance-hero"><div class="amt">'+heroAmt+'</div><div class="lbl">'+heroLbl+'</div></div>'+
    '<div class="section-label" style="display:flex;justify-content:space-between;align-items:center;">Everyone on the trip'+
      '<button class="btn btn-ghost btn-sm" data-action="trip-settings">+ Invite friends</button></div><div class="card">'+rows+'</div>'+
    '<div class="muted" style="font-size:11.5px;padding:8px 2px;">'+
      inr(total)+' logged across '+S.bills.length+' bill'+(S.bills.length===1?"":"s")+
      ' · '+S.people.length+' people joined</div>';
}

function viewBills(){
  if(!S.bills.length){
    return '<button class="btn btn-brand btn-wide scan-cta" data-action="scan-bill">📷 Scan a bill</button>'+
      '<div class="empty"><span class="big">🧾</span>No bills yet<br>Scan a receipt, or tap + to type one in.</div>';
  }
  var sorted = S.bills.slice().sort(function(a,b){
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
  var rows = sorted.map(function(b){
    var splitTxt;
    if(b.splitMode==="itemized"){
      var n = (b.items||[]).length;
      splitTxt = n+" item"+(n===1?"":"s")+" · "+b.split.length+" people"+((b.extras||[]).length ? " · tax shared by item" : "");
    } else {
      splitTxt = (b.split.length===S.people.length && S.people.length>0)
        ? "split with everyone" : ("split "+b.split.length+" way"+(b.split.length===1?"":"s"));
      if(b.splitMode && b.splitMode!=="equal") splitTxt += " · " + (b.splitMode==="exact"?"custom":"uneven");
    }
    return '<div class="bill-row" data-action="open-bill" data-id="'+esc(b.id)+'">'+
      '<div class="bill-icon">'+(b.splitMode==="itemized"?"🧾":catIcon(b.category))+'</div>'+
      '<div class="bill-mid"><div class="bill-desc">'+esc(b.desc)+'</div>'+
      '<div class="bill-sub">'+(b.billDate ? esc(fmtYmdShort(b.billDate))+' · ' : '')+esc(pName(b.paidBy))+' paid · '+splitTxt+'</div></div>'+
      '<div class="bill-amt">'+(b.currency==="LKR" && b.origAmount
        ? fmtLkr(b.origAmount)+'<div class="bill-sub" style="text-align:right;">'+inr(b.amount)+'</div>'
        : inr(b.amount))+'</div></div>';
  }).join("");
  var total = S.bills.reduce(function(s,b){ return s+b.amount; }, 0);
  return '<button class="btn btn-brand btn-wide scan-cta" data-action="scan-bill">📷 Scan a bill</button>'+
    '<div class="section-label">All bills · '+inr(total)+' total</div><div class="card">'+rows+'</div>'+
         '<div class="muted" style="font-size:11.5px;padding:4px 2px;">Tap a bill to edit or delete it.</div>';
}

function viewSettle(){
  var bal = computeBalances();
  var txns = computeSettlements(bal);
  var body;
  if(!txns.length){
    body = '<div class="empty"><span class="big">🎉</span>All settled up<br>Nobody owes anybody right now.</div>';
  } else {
    body = '<div class="card">' + txns.map(function(t){
      var toP = person(t.to);
      var upiBtn = toP.upi
        ? '<button class="btn btn-ghost btn-sm" data-action="copy-upi" data-id="'+esc(t.to)+'">Copy '+esc(toP.name)+"'s UPI</button>"
        : '<span class="muted" style="font-size:11.5px;align-self:center;">'+esc(toP.name)+' hasn’t added a UPI ID</span>';
      return '<div class="settle-row">'+
        '<div class="settle-top">'+esc(pName(t.from))+' <span class="settle-arrow">→</span> '+esc(pName(t.to))+'</div>'+
        '<div class="settle-amt">'+inr(t.amount)+'</div>'+
        '<div class="settle-actions">'+
          '<button class="btn btn-brand btn-sm" data-action="mark-paid" data-from="'+esc(t.from)+
            '" data-to="'+esc(t.to)+'" data-amount="'+t.amount+'">Mark paid</button>'+
          upiBtn+
        '</div></div>';
    }).join("") + '</div>';
  }

  var hist = "";
  if(S.settlements.length){
    var recent = S.settlements.slice().sort(function(a,b){
      return String(b.createdAt).localeCompare(String(a.createdAt));
    }).slice(0,12);
    hist = '<div class="section-label">Payments recorded</div><div class="card">' +
      recent.map(function(s){
        return '<div class="hist-row"><div style="flex:1;min-width:0;">'+
          esc(pName(s.from))+' → '+esc(pName(s.to))+' · <strong>'+inr(s.amount)+'</strong>'+
          '</div><button class="btn btn-line btn-sm" data-action="undo-settle" data-id="'+esc(s.id)+'">Undo</button></div>';
      }).join("") + '</div>';
  }

  return '<div class="section-label">Suggested settlements</div>'+body+
    '<div class="muted" style="font-size:11.5px;padding:8px 2px;">These are the fewest payments that clear everyone. Paid in person? Tap “Mark paid” and everyone’s app updates.</div>'+
    hist;
}

/* ====================== Sheets ====================== */

var openSheetEl = null;
var sheetOnDismiss = null;   // called only when the person taps outside to dismiss
var scrim = document.getElementById("scrim");

function closeSheet(){
  sheetOnDismiss = null;
  if(!openSheetEl) return;
  var el = openSheetEl;
  el.classList.remove("show");
  scrim.classList.remove("show");
  openSheetEl = null;
  setTimeout(function(){ if(el.parentNode) el.parentNode.removeChild(el); }, 220);
}
scrim.addEventListener("click", dismissSheet);

/** Closes the sheet the same way tapping outside does (runs its onDismiss). */
function dismissSheet(){
  var cb = sheetOnDismiss;
  closeSheet();
  if(cb) cb();
}

function openSheetHtml(html, onMount, onDismiss){
  closeSheet();
  var el = document.createElement("div");
  el.className = "sheet";
  el.innerHTML = '<div class="sheet-handle"></div>'+
    '<button class="sheet-x" aria-label="Close">✕</button>' + html;
  document.body.appendChild(el);
  openSheetEl = el;
  sheetOnDismiss = onDismiss || null;
  scrim.classList.add("show");
  requestAnimationFrame(function(){ el.classList.add("show"); });
  el.querySelector(".sheet-x").addEventListener("click", dismissSheet);
  enableSwipeDown(el);
  if(onMount) onMount(el);
}

/** Drag a sheet down to close it. Starts from the handle area anywhere, or
    from inside the sheet when it's scrolled to the top — so scrolling a
    long form up and down still works normally. */
function enableSwipeDown(el){
  var startY = null, dy = 0, dragging = false, fromTop = false, startT = 0;
  el.addEventListener("touchstart", function(e){
    if(e.touches.length !== 1) return;
    var t = e.target, rect = el.getBoundingClientRect();
    var onHandle = e.touches[0].clientY - rect.top < 44;
    var tag = (t.tagName || "").toLowerCase();
    if(!onHandle && (tag === "input" || tag === "textarea" || tag === "select")) return;
    fromTop = onHandle || el.scrollTop <= 0;
    if(!fromTop) return;
    startY = e.touches[0].clientY; dy = 0; dragging = false; startT = Date.now();
  }, { passive:true });
  el.addEventListener("touchmove", function(e){
    if(startY == null) return;
    dy = e.touches[0].clientY - startY;
    if(!dragging){
      if(dy > 8 && el.scrollTop <= 0){ dragging = true; el.style.transition = "none"; }
      else if(dy < -4){ startY = null; return; }   // scrolling up: normal scroll
      else return;
    }
    e.preventDefault();
    el.style.transform = "translateY(" + Math.max(0, dy) + "px)";
  }, { passive:false });
  el.addEventListener("touchend", function(){
    if(startY == null) return;
    var fast = dy > 60 && (Date.now() - startT) < 250;
    startY = null;
    if(!dragging) return;
    el.style.transition = "";
    if(dy > 110 || fast){ el.style.transform = ""; dismissSheet(); }
    else el.style.transform = "";
  });
}

/* ---- Join / profile ---- */

function showJoinScreen(){
  var sp = document.getElementById("boot-spinner");
  if(sp) sp.style.display = "none";
  var bm = document.getElementById("boot-msg");
  if(bm) bm.textContent = "Checking…";
  // Watch our own people doc (appears when approved) and our request (to
  // show "waiting" vs the form, and notice a decline).
  stopJoinWatch();
  var hadRequest = false;
  unsubMyPerson = db.collection("people").doc(docId(S.me)).onSnapshot(function(doc){
    if(doc.exists){ toast("You're in — welcome aboard!"); restartListeners(); }
  }, function(){});
  unsubMyRequest = db.collection("requests").doc(docId(S.me)).onSnapshot(function(doc){
    if(doc.exists){ hadRequest = true; renderWaiting(doc.data()); }
    else if(hadRequest){
      // Request removed without an approval arriving → declined (give the
      // approval a moment to land first, since both happen together).
      setTimeout(function(){ if(unsubMyRequest) renderForm("Your request wasn't approved. Check with the organiser, then ask again."); }, 2500);
    } else renderForm("");
  }, function(){ renderForm(""); });

  function renderForm(note){
    hadRequest = false;
    if(bm) bm.textContent = note || "You're signed in. Ask to join — the organiser will approve you.";
    var be = document.getElementById("boot-extra");
    if(!be) return;
    be.innerHTML =
      '<div class="join-card">'+
        '<div class="join-email">'+(S.myPhoto?'<img src="'+esc(S.myPhoto)+'" alt="">':'')+'<span>'+esc(S.me)+'</span></div>'+
        '<div class="field"><label>Your name</label>'+
          '<input type="text" id="j-name" placeholder="How the group knows you" maxlength="40"></div>'+
        '<div class="field"><label>UPI ID <span class="muted">(optional — so others can pay you)</span></label>'+
          '<input type="text" id="j-upi" placeholder="name@bank" maxlength="60"></div>'+
        '<button class="btn btn-brand btn-wide" id="j-go">'+(S.me === ORGANISER_EMAIL ? "Start the group" : "Ask to join")+'</button>'+
        '<button class="btn btn-ghost btn-wide" id="j-out" style="margin-top:8px;">Use a different Google account</button>'+
      '</div>';
    document.getElementById("j-go").addEventListener("click", function(){
      var name = document.getElementById("j-name").value.trim();
      if(!name){ toast("Add your name first", true); return; }
      var btn = this;
      btn.disabled = true; btn.textContent = "Sending…";
      requestToJoin(name, document.getElementById("j-upi").value.trim()).catch(function(err){
        btn.disabled = false; btn.textContent = "Ask to join";
        toast(friendlyError(err), true);
      });
    });
    document.getElementById("j-out").addEventListener("click", function(){ auth.signOut(); });
  }

  function renderWaiting(d){
    if(bm) bm.textContent = "Request sent ✓";
    var be = document.getElementById("boot-extra");
    if(!be) return;
    be.innerHTML =
      '<div class="join-card" style="text-align:center;">'+
        '<div style="font-size:30px;">⏳</div>'+
        '<div style="font-weight:700;margin:6px 0 4px;">Waiting for the organiser to approve you</div>'+
        '<div class="muted" style="font-size:13px;line-height:1.5;">You asked to join as <b>'+esc(d && d.name || "")+'</b>. '+
          'Keep this open or come back later — you\'ll get in automatically once you\'re approved.</div>'+
        '<button class="btn btn-ghost btn-wide" id="j-cancel" style="margin-top:14px;">Cancel request</button>'+
      '</div>';
    document.getElementById("j-cancel").addEventListener("click", function(){
      hadRequest = false;
      db.collection("requests").doc(docId(S.me)).delete().catch(function(err){ toast(friendlyError(err), true); });
    });
  }
}

function openProfileSheet(){
  var me = person(S.me);
  openSheetHtml(
    '<h3>Your details</h3>'+
    '<div class="join-email">'+(S.myPhoto?'<img src="'+esc(S.myPhoto)+'" alt="">':'')+'<span>'+esc(S.me)+'</span></div>'+
    '<div class="field"><label>Name</label><input type="text" id="p-name" maxlength="40" value="'+esc(me.name)+'"></div>'+
    '<div class="field"><label>UPI ID</label><input type="text" id="p-upi" maxlength="60" placeholder="name@bank" value="'+esc(me.upi)+'"></div>'+
    (passkeySupported()
      ? '<div class="field"><label>Face ID lock on this device</label>'+
          '<button class="btn btn-line btn-sm" id="p-faceid">'+(passkeyFor(S.me) ? "Turn off Face ID lock" : "Turn on Face ID lock")+'</button></div>'
      : '')+
    '<div class="sheet-actions"><button class="btn btn-brand" id="p-save">Save</button>'+
    '<button class="btn btn-ghost" id="p-signout">Sign out</button></div>',
    function(el){
      el.querySelector("#p-save").addEventListener("click", function(){
        var name = el.querySelector("#p-name").value.trim();
        if(!name){ toast("Name can't be empty", true); return; }
        writeOp(updateProfile(name, el.querySelector("#p-upi").value.trim()), "Saved", this);
      });
      var fid = el.querySelector("#p-faceid");
      if(fid) fid.addEventListener("click", function(){
        if(passkeyFor(S.me)){
          setStoredPasskey(null);
          lsSet("pw_passkey_dismissed", S.me);
          fid.textContent = "Turn on Face ID lock";
          toast("Face ID lock turned off");
        } else {
          fid.disabled = true;
          registerPasskey(S.me).then(function(){
            markUnlocked(S.me);
            lsSet("pw_passkey_dismissed", null);
            fid.disabled = false;
            fid.textContent = "Turn off Face ID lock";
            toast("Face ID lock is on for this device");
          }).catch(function(err){
            fid.disabled = false;
            if(!(err && err.name==="NotAllowedError")) toast(err && err.message ? err.message : "Couldn't set that up", true);
          });
        }
      });
      el.querySelector("#p-signout").addEventListener("click", function(){
        closeSheet();
        auth.signOut();
      });
    }
  );
}

/* ---- Receipt OCR (on-device, no server, no API key) ---- */

var tesseractLoadPromise = null;
function loadTesseract(){
  if(window.Tesseract) return Promise.resolve();
  if(tesseractLoadPromise) return tesseractLoadPromise;
  tesseractLoadPromise = new Promise(function(resolve, reject){
    var s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    s.onload = function(){ resolve(); };
    s.onerror = function(){ reject(new Error("Couldn't load the text scanner — check your connection.")); };
    document.head.appendChild(s);
  });
  return tesseractLoadPromise;
}

/* ---- Reading receipt text ----
   Every priced line becomes one of:
     item     — something someone ate/bought
     charge   — service charge, VAT, tax, SSCL, tip… (shared in proportion to items)
     discount — discount, offer, promo… (shared in proportion to items)
     ignore   — sub-total, total, cash, change, card, table/bill numbers…
   The person reviews and fixes everything before it's used. */
var RECEIPT_TOTAL_RE    = /\b(grand\s*t[o0]t\w*|net\s*t[o0]t\w*|t[o0]ta[l1I|\]]?(\s*(amount|payable|due|lkr|rs|inr))?|amount\s*(due|payable)|net\s*amount|bill\s*amount|net\s*payable)(?![a-z])/i;
var RECEIPT_SUBTOTAL_RE = /\b(sub\s*-?\s*t[o0]t\w*|gross(\s*amount)?|taxable\s*(amount|value))/i;
var RECEIPT_IGNORE_RE   = /\b(cash|change|tender(ed)?|paid|card|visa|master(card)?|amex|upi|balance|round(ing)?\s*off|items?\s*count|no\.?\s*of\s*items|qty\s*total|gstin|fssai|pax)\b/i;
var RECEIPT_CHARGE_RE   = /\b(service|svc|s\/c|sc|tax|vat|gst|cgst|sgst|igst|utgst|sscl|cess|levy|tip|gratuity|delivery|packing|packaging|container|cover\s*charge)\b/i;
var RECEIPT_DISCOUNT_RE = /\b(discount|disc|less|offer|promo|coupon|voucher|deduction)\b/i;
var RECEIPT_META_RE     = /\b(table(?!\s*water)|bill\s*no|no\s*[:.#]|invoice|order\s*(no|#)|kot|token|tel|phone|mob(ile)?|dine\s*in|take\s*away|captain|manager|cashier|steward)\b/i;
var RECEIPT_HEADER_RE   = /^(table|tbl|tel|phone|ph|mob|date|time|bill\s*no|invoice|inv|order|receipt|guest|pax|covers?|cashier|server|waiter|steward|token|kot|gst\s*no|gstin|fssai|vat\s*(reg|no)|tin|reg)\b(?!\s*water)/i;
var RECEIPT_NOTE_RE     = /^\s*(note|notes|nb|remark|remarks|instruction|comment)s?\s*[:\-]/i;

/** Fixes common OCR slips at the end of a line so the price can be read:
    "10 ,942-98" → "10,942.98", "g 010.90" → "9 010.90", "-500 .00" → "-500.00",
    "450/=" → "450", trailing "|" removed, O→0 next to digits. */
function tidyReceiptLine(line){
  var s = String(line).replace(/[|¦`'"_~;:]+\s*$/g, "").replace(/\s*\/\s*[-=]+\s*$/, "").replace(/\s+$/, "");
  var m = /^(.*?)([-(]?\s*(?:₹|rs\.?|lkr|inr)?\s*[0-9OoSgB,.\s-]*[0-9][0-9OoSgB,.\s-]*\)?)$/i.exec(s);
  if(!m) return s;
  var head = m[1], tail = m[2];
  if(!/\d/.test(tail)) return s;
  var fixed = tail
    .replace(/(^|[\s,.(-])[gB](?=\s*\d)/g, function(_, p){ return p + "9"; })
    .replace(/(\d)\s*[Oo]|[Oo]\s*(?=\d)/g, function(x){ return x.replace(/[Oo]/g, "0"); })
    .replace(/(\d)\s*S(?=\d)/g, "$15")
    .replace(/(\d) ?([.,]) ?(\d)/g, "$1$2$3")
    .replace(/(\d)-(\d{2})\s*\)?$/, "$1.$2");
  return head + fixed;
}

function parseReceiptNumber(str){
  var t = String(str).replace(/\s/g, "");
  if(/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else if(/^\d+,\d{2}$/.test(t)) t = t.replace(",", ".");
  else t = t.replace(/,/g, "");
  return parseFloat(t);
}

/** One column cell → number, or null if it isn't one. Knows the usual OCR
    confusions for a lone "1" (I, l, |, i) and "2 960.00" split thousands. */
function receiptCellNumber(cell){
  var c = String(cell).trim().replace(/^[₹]|^(rs\.?|lkr|inr)\s*/i, "");
  if(/^[Il|i!\]\[]$/.test(c)) return 1;
  c = c.replace(/^(\d{1,3}) (\d{3}(?:[.,]\d{1,2})?)$/, "$1,$2");       // "2 960.00"
  if(!/^[-(]?\d[\d,]*(?:\.\d{1,2})?\)?$/.test(c)) return null;
  var neg = /^[-(]/.test(c);
  var v = parseReceiptNumber(c.replace(/[()-]/g, ""));
  return isFinite(v) ? (neg ? -v : v) : null;
}

/** Cleans an item name: drops stray OCR marks from ruled lines, fixes "]"
    at the end of a word (usually an "l": "Bage]" → "Bagel"). */
function cleanReceiptName(parts){
  var cells = parts.map(function(x){ return String(x).trim(); }).filter(function(x){
    if(!x) return false;
    var letters = (x.match(/[a-z]/ig) || []).length;
    return letters >= 3 || (letters >= 2 && x.length <= 4 && /^[A-Z]{2,4}$/.test(x)) || /\d/.test(x) && letters >= 1;
  });
  var name = cells.join(" ").replace(/\](?=\s|$)/g, "l").replace(/\s+/g, " ").trim();
  return name.replace(/^[^a-z0-9(&']+/i, "").replace(/[\s:.\-–=\\\/|,;]+$/, "");
}

function classifyReceiptLine(desc, negative){
  if(RECEIPT_SUBTOTAL_RE.test(desc)) return "subtotal";
  if(RECEIPT_TOTAL_RE.test(desc)) return "total";
  if(RECEIPT_IGNORE_RE.test(desc) || RECEIPT_HEADER_RE.test(desc) || RECEIPT_META_RE.test(desc)) return "ignore";
  if(RECEIPT_DISCOUNT_RE.test(desc) || negative) return "discount";
  if(RECEIPT_CHARGE_RE.test(desc)) return "charge";
  return "item";
}

/** Reads the receipt text into lines the person can check.
    - Skips everything above the "Item / Qty / Rate / Amount" header
      (shop name, address, GSTIN, phone, table/pax…).
    - Reads columns (OCR keeps them 2+ spaces apart), so qty and rate never
      end up in the item name, and flags lines where qty × rate ≠ amount.
    - Names that wrap onto the next line are joined back; ₹0 add-ons
      ("Scrambled", "Pineapple") are attached to the item above; "note:"
      lines are dropped.
    - Stops at the grand total (cash, change etc. are ignored). */
function parseReceiptLines(rawText){
  var raw = String(rawText||"").split(/\r?\n/).map(function(l){ return l.replace(/\s+$/,""); }).filter(function(l){ return l.trim().length > 1; });
  var out = [], receiptTotal = null, receiptSubtotal = null, expectedItems = null;

  // Find the column header and anything useful above it.
  var start = 0;
  for(var h = 0; h < raw.length; h++){
    var hl = raw[h];
    var cnt = /(\d{1,3})\s*items?\b/i.exec(hl);
    if(cnt && expectedItems == null) expectedItems = +cnt[1];
    if(/\b(qty|quantity|qnty)\b/i.test(hl) && /\b(amount|amt|total|price|rate|value)\b/i.test(hl) && !/\d{3,}/.test(hl)){ start = h + 1; break; }
    if(/\b(item|items|description|particulars|name)\b/i.test(hl) && /\b(amount|amt|price)\b/i.test(hl) && !/\d{3,}/.test(hl)){ start = h + 1; break; }
  }

  var pending = [];                          // text-only lines waiting to be placed
  var lastItem = null, done = false;
  function flushToLast(){
    if(lastItem && pending.length) lastItem.desc = cleanText(lastItem.desc + " " + pending.join(" "), MAX_DESC_LEN);
    pending = [];
  }

  for(var i = start; i < raw.length && !done; i++){
    var orig = raw[i];
    if(RECEIPT_NOTE_RE.test(orig.replace(/^[^a-z]*/i, ""))) continue;          // "note: welldone"
    if(/^[\s\-=_*.~—–]+$/.test(orig)) { flushToLast(); continue; }            // ruled line

    var line = tidyReceiptLine(orig);
    var cells = line.split(/\s{2,}|\s*\|\s*/).map(function(c){ return c.trim(); }).filter(function(c){ return c && !/^[^\w₹()-]+$/.test(c); });
    // Trailing numeric cells = [qty] [rate] amount
    var nums = [];
    while(cells.length && receiptCellNumber(cells[cells.length-1]) !== null && nums.length < 3){
      nums.unshift(receiptCellNumber(cells.pop()));
    }
    // Single-space OCR (no column gaps): fall back to "name … 123.45" at the end.
    if(!nums.length && cells.length){
      var m = /(-|\()?\s*(?:₹|rs\.?|lkr|inr)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*\)?\s*$/i.exec(cells[cells.length-1]);
      if(m && m.index > 0){
        var v = parseReceiptNumber(m[2]);
        cells[cells.length-1] = cells[cells.length-1].slice(0, m.index);
        nums = [m[1] ? -v : v];
        var qm;
        var lc = cells[cells.length-1];
        if((qm = /\s(\d{1,3}|[Il|])\s*[xX@*]\s*([\d.,]+)\s*$/.exec(" "+lc)) || (qm = /\s(\d{1,3}|[Il|])\s+([\d.,]+)\s*$/.exec(" "+lc))){ nums.unshift(receiptCellNumber(qm[1]), receiptCellNumber(qm[2])); cells[cells.length-1] = (" "+lc).slice(0, qm.index); }
        else if((qm = /\s(\d{1,2}|[Il|])\s*[xX@*]?\s*$/.exec(" "+lc)) && /[a-z]{2}/i.test(lc)){ nums.unshift(receiptCellNumber(qm[1])); cells[cells.length-1] = (" "+lc).slice(0, qm.index); }
      }
    }
    var name = cleanReceiptName(cells);
    var qx;
    if((qx = /^(\d{1,2})\s*[xX]?\s+(?=[a-z])/i.exec(name))){ nums.unshift(+qx[1]); name = name.slice(qx[0].length); }   // "2 x Tea"

    if(!nums.length){
      // Text only: part of a wrapped name, or a name whose price is below.
      if(name && /[a-z]{3,}/i.test(name) && !RECEIPT_HEADER_RE.test(name) && !RECEIPT_META_RE.test(name)) pending.push(name);
      continue;
    }

    var amount = round2(Math.abs(nums[nums.length-1]));
    var negative = nums[nums.length-1] < 0 || /^\s*\(/.test(orig.slice(-12)) || /-\s*[\d.,]+\s*$/.test(line);
    if(!isFinite(amount) || amount > MAX_AMOUNT){ pending = []; continue; }
    if(/\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{1,2}:\d{2}/.test(orig) && !/[a-z]{4,}.*\d+\.\d{2}\s*$/i.test(orig)) { pending = []; continue; }

    // A ₹0 line is an add-on/choice for the item above ("Scrambled", "Pineapple").
    if(amount === 0){
      var mod = pending.length ? pending.pop() : name;
      flushToLast();
      if(lastItem && mod && /[a-z]{3,}/i.test(mod)) lastItem.desc = cleanText(lastItem.desc + " (" + mod + ")", MAX_DESC_LEN);
      continue;
    }

    if(!/[a-z]{2,}/i.test(name)){
      if(pending.length){ name = pending.join(" "); pending = []; }     // name was on the line(s) above
      else continue;                                                    // bare numbers
    }
    var kind = classifyReceiptLine(name, negative);
    if(kind === "item") flushToLast(); else { flushToLast(); }

    var qty = 0, warn = false;
    if(nums.length >= 3){
      qty = nums[nums.length-3];
      var rate = nums[nums.length-2];
      if(qty > 0 && rate > 0 && Math.abs(qty*rate - amount) > 1) warn = true;
    } else if(nums.length === 2 && Number.isInteger(nums[0]) && nums[0] > 0 && nums[0] <= 99 && nums[0] !== amount){
      qty = nums[0];
    }

    name = cleanText(name.replace(/\s+on\s+[\d,]+(\.\d+)?\s*$/i, ""), MAX_DESC_LEN);   // "10% on 2,960.00"
    var pct = /(\d{1,2}(?:\.\d{1,2})?)\s*%/.exec(name);
    if(pct && kind !== "item") name = name.slice(0, pct.index + pct[0].length);             // drop OCR junk after "10%"

    if(kind === "subtotal"){ receiptSubtotal = amount; out.push({ desc:name, amount:amount, kind:"ignore", qty:0, pct:null }); lastItem = null; continue; }
    if(kind === "total"){ receiptTotal = amount; out.push({ desc:name, amount:amount, kind:"ignore", qty:0, pct:null }); lastItem = null; done = true; continue; }

    // Tax/service printed as a % of the sub-total: if the amount OCR'd doesn't
    // fit, use the worked-out amount instead and flag it for checking.
    if((kind === "charge" || kind === "discount") && pct && receiptSubtotal){
      var expected = round2(receiptSubtotal * (+pct[1]) / 100);
      // Only step in when the reading is wildly off (tax is often charged on a
      // different base, so a modest difference is normal and left alone).
      if(expected > 0 && (amount < expected*0.25 || amount > expected*4)){ amount = expected; warn = true; }
    }
    if(kind !== "item" && amount < 1) continue;
    var row = { desc: name, amount: amount, kind: kind, qty: qty > 1 ? qty : 0, pct: pct ? +pct[1] : null, warn: warn };
    out.push(row);
    lastItem = kind === "item" ? row : null;
  }
  flushToLast();

  out.receiptTotal = receiptTotal;
  out.receiptSubtotal = receiptSubtotal;
  out.expectedItems = expectedItems;
  out.headerFound = start > 0;
  return out;
}

/** First line that looks like a shop name (letters, no price) — usually the
    restaurant/shop printed at the top of the receipt. */
function guessReceiptTitle(rawText){
  var ls = String(rawText||"").split(/\r?\n/).map(function(l){ return l.replace(/[|]/g,"").replace(/\s+/g," ").trim(); });
  for(var i=0; i<Math.min(ls.length, 6); i++){
    var l = ls[i];
    if(l.length < 3 || l.length > 40) continue;
    if(!/[a-z]{3,}/i.test(l)) continue;
    if(/\d{5,}|@|www\.|\.com|\.club|\.lk|\.in\b/i.test(l)) continue;          // phone, pincode, email, web
    if((l.match(/[a-z]/ig) || []).length / l.length < 0.55) continue;            // mostly OCR noise
    if(RECEIPT_HEADER_RE.test(l) || RECEIPT_TOTAL_RE.test(l) || RECEIPT_IGNORE_RE.test(l)) continue;
    return cleanText(l.toLowerCase().replace(/\b\w/g, function(c){ return c.toUpperCase(); }), MAX_DESC_LEN);
  }
  return "";
}

/* ---- Photo clean-up before OCR ----
   1. Find the white receipt paper in the photo and crop to it (a receipt
      that's small in the frame is otherwise unreadable).
   2. Scale so the receipt is ~1600px wide. (The old code shrank the LONG
      side to 1600px, which made tall receipts too narrow to read.)
   3. Even out shadows/uneven light (divide by a blurred copy), greyscale,
      and stretch contrast. */
function loadImageEl(file){
  return new Promise(function(resolve, reject){
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function(){ resolve({ img:img, url:url }); };
    img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error("Couldn't open that photo")); };
    img.src = url;
  });
}

function findPaperBox(img){
  var s = 400 / Math.max(img.naturalWidth, img.naturalHeight);
  var w = Math.max(8, Math.round(img.naturalWidth * s)), h = Math.max(8, Math.round(img.naturalHeight * s));
  var c = document.createElement("canvas"); c.width = w; c.height = h;
  var ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, w, h);
  var d = ctx.getImageData(0, 0, w, h).data, g = new Float32Array(w*h), sum = 0, sum2 = 0;
  for(var i=0, p=0; i<d.length; i+=4, p++){ var v = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]; g[p] = v; sum += v; sum2 += v*v; }
  var n = w*h, mean = sum/n, sd = Math.sqrt(Math.max(0, sum2/n - mean*mean));
  var sorted = Array.prototype.slice.call(g).sort(function(a,b){ return a-b; });
  var thr = Math.max(sorted[Math.floor(n*0.6)], mean + 0.35*sd);
  var colFrac = new Float32Array(w), rowFrac = new Float32Array(h);
  for(var y=0; y<h; y++) for(var x=0; x<w; x++) if(g[y*w+x] > thr){ colFrac[x]++; rowFrac[y]++; }
  var x0=-1, x1=-1, y0=-1, y1=-1;
  for(x=0; x<w; x++) if(colFrac[x]/h > 0.25){ if(x0<0) x0 = x; x1 = x; }
  for(y=0; y<h; y++) if(rowFrac[y]/w > 0.15){ if(y0<0) y0 = y; y1 = y; }
  if(x0 < 0 || y0 < 0 || x1-x0 < 10 || y1-y0 < 10) return null;
  // Only crop when the receipt is small in the photo. If it already fills
  // most of the frame, keep everything — a shadowed or curled edge can look
  // like background and cropping would cut letters off the item names.
  if((x1-x0+1)*(y1-y0+1) > 0.5*w*h) return null;
  var px = Math.round(w*0.06), py = Math.round(h*0.04);
  x0 = Math.max(0, x0-px); y0 = Math.max(0, y0-py); x1 = Math.min(w-1, x1+px); y1 = Math.min(h-1, y1+py);
  return { x: x0/s, y: y0/s, w: (x1-x0+1)/s, h: (y1-y0+1)/s };
}

function prepareReceiptImage(file){
  return loadImageEl(file).then(function(o){
    var img = o.img;
    try{
      var box = findPaperBox(img) || { x:0, y:0, w:img.naturalWidth, h:img.naturalHeight };
      // A colour copy of just the receipt, for checking against in the review.
      var preview = o.url;
      try{
        var pk = Math.min(1, 900 / box.w), pc = document.createElement("canvas");
        pc.width = Math.max(1, Math.round(box.w*pk)); pc.height = Math.max(1, Math.round(box.h*pk));
        pc.getContext("2d").drawImage(img, box.x, box.y, box.w, box.h, 0, 0, pc.width, pc.height);
        preview = pc.toDataURL("image/jpeg", 0.82);
        URL.revokeObjectURL(o.url);
      }catch(e){}
      var k = 1600 / box.w;
      if(box.w*box.h*k*k > 6e6) k = Math.sqrt(6e6 / (box.w*box.h));
      var W = Math.max(1, Math.round(box.w*k)), H = Math.max(1, Math.round(box.h*k));
      var c = document.createElement("canvas"); c.width = W; c.height = H;
      var ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, W, H);
      var id = ctx.getImageData(0, 0, W, H), d = id.data, N = W*H;
      var g = new Uint8ClampedArray(N);
      for(var i=0, p=0; p<N; i+=4, p++) g[p] = (77*d[i] + 150*d[i+1] + 29*d[i+2]) >> 8;
      // integral image for a fast box blur (background estimate)
      var I = new Uint32Array((W+1)*(H+1));
      for(var y=1; y<=H; y++){
        var row = 0;
        for(var x=1; x<=W; x++){ row += g[(y-1)*W + (x-1)]; I[y*(W+1)+x] = I[(y-1)*(W+1)+x] + row; }
      }
      var r = Math.max(8, Math.round(W/64)), norm = new Float32Array(N), hist = new Uint32Array(256);
      for(y=0; y<H; y++){
        var ya = Math.max(0, y-r), yb = Math.min(H, y+r+1);
        for(x=0; x<W; x++){
          var xa = Math.max(0, x-r), xb = Math.min(W, x+r+1);
          var area = (yb-ya)*(xb-xa);
          var bsum = I[yb*(W+1)+xb] - I[ya*(W+1)+xb] - I[yb*(W+1)+xa] + I[ya*(W+1)+xa];
          var v = Math.min(255, g[y*W+x] / (bsum/area + 1) * 255 * 0.92);
          norm[y*W+x] = v; hist[v|0]++;
        }
      }
      var lo = 0, hi = 255, acc = 0;
      for(var t=0; t<256; t++){ acc += hist[t]; if(acc >= N*0.02){ lo = t; break; } }
      acc = 0;
      for(t=255; t>=0; t--){ acc += hist[t]; if(acc >= N*0.02){ hi = t; break; } }
      var span = Math.max(1, hi - lo);
      for(i=0, p=0; p<N; i+=4, p++){
        var o2 = Math.max(0, Math.min(255, (norm[p]-lo)/span*255));
        d[i] = d[i+1] = d[i+2] = o2; d[i+3] = 255;
      }
      ctx.putImageData(id, 0, 0);
      var M = 48, bc = document.createElement("canvas");
      bc.width = W + 2*M; bc.height = H + 2*M;
      var bctx = bc.getContext("2d");
      bctx.fillStyle = "#fff"; bctx.fillRect(0, 0, bc.width, bc.height);
      bctx.drawImage(c, M, M);
      return { canvas: bc, photoUrl: preview };
    } catch(e){
      return { canvas: img, photoUrl: o.url };
    }
  });
}

function scanReceiptImage(file, btn){
  var label = btn ? btn.textContent : "";
  function progress(txt){ if(btn) btn.textContent = txt; }
  if(btn) btn.disabled = true;
  progress("Loading scanner…");
  var prepared = null;
  return loadTesseract().then(function(){
    progress("Preparing photo…");
    return prepareReceiptImage(file);
  }).then(function(p){
    prepared = p;
    return Tesseract.createWorker("eng", 1, {
      logger: function(m){
        if(m && m.status === "recognizing text") progress("Reading… " + Math.round((m.progress||0)*100) + "%");
        else if(m && /load/i.test(m.status||"")) progress("Loading scanner…");
      }
    });
  }).then(function(worker){
    // Receipts are one column of left/right-aligned text: "single block"
    // mode reads them far better than automatic layout detection.
    return worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" })
      .then(function(){ return worker.recognize(prepared.canvas); })
      .then(function(res){ worker.terminate(); return res; }, function(err){ worker.terminate(); throw err; });
  }).then(function(result){
    if(btn){ btn.disabled = false; progress(label); }
    var text = result && result.data && result.data.text || "";
    var lines = parseReceiptLines(text);
    lines.title = guessReceiptTitle(text);
    lines.lkr = /\bLKR\b|රු/i.test(text);
    lines.photoUrl = prepared.photoUrl;
    return lines;
  }).catch(function(err){
    if(btn){ btn.disabled = false; progress(label); }
    throw err;
  });
}

var RC_KINDS = ["item","charge","discount","ignore"];
var RC_LABEL = { item:"Item", charge:"+ Tax / svc", discount:"− Discount", ignore:"Skip" };

function openReceiptReviewSheet(candidates, onConfirm, onBack){
  var receiptTotal = candidates.receiptTotal != null ? candidates.receiptTotal : null;
  var receiptSubtotal = candidates.receiptSubtotal != null ? candidates.receiptSubtotal : null;
  var totalIdx = -1;
  candidates.forEach(function(c, i){
    if(c.kind === "ignore" && RECEIPT_TOTAL_RE.test(c.desc) && !RECEIPT_SUBTOTAL_RE.test(c.desc) && c.amount === receiptTotal) totalIdx = i;
  });
  var rows = candidates.map(function(c, i){
    return { desc: c.desc + (c.qty ? " ×" + c.qty : ""), amount: c.amount, kind: c.kind, pct: c.pct, warn: !!c.warn, isTotal: i === totalIdx };
  });
  var showSkipped = false;
  var cur = draftCurrency;

  function sums(){
    var t = { item:0, charge:0, discount:0 };
    rows.forEach(function(r){ var v = Number(r.amount)||0; if(t[r.kind] != null) t[r.kind] = round2(t[r.kind] + v); });
    t.total = round2(t.item + t.charge - t.discount);
    return t;
  }
  function rowHtml(r, i){
    if(r.isTotal){
      return '<div class="rc-row rc-total">'+
        '<span class="rc-kind rc-kind-total">Receipt total</span>'+
        '<input type="text" class="split-input rc-desc" value="'+esc(r.desc)+'" disabled>'+
        '<input type="number" inputmode="decimal" class="split-input rc-amt" data-role="rc-amt" data-i="'+i+'" value="'+esc(r.amount)+'">'+
      '</div>';
    }
    if(r.kind === "ignore" && !showSkipped && !r.userSkipped) return "";
    return '<div class="rc-row rc-'+r.kind+(r.warn ? ' rc-warn' : '')+'">'+
      '<button class="rc-kind" data-role="rc-kind" data-i="'+i+'">'+RC_LABEL[r.kind]+'</button>'+
      '<input type="text" class="split-input rc-desc" data-role="rc-desc" data-i="'+i+'" value="'+esc(r.desc)+'" maxlength="80">'+
      '<input type="number" inputmode="decimal" class="split-input rc-amt" data-role="rc-amt" data-i="'+i+'" value="'+esc(r.amount)+'">'+
    '</div>'+
    (r.warn ? '<div class="rc-warn-note">⚠ Check this amount against the photo'+(r.kind === "item" ? ' — qty × rate didn\'t match' : ' — worked out from the %')+'</div>' : '');
  }
  function summaryHtml(){
    var t = sums();
    var nItems = rows.filter(function(r){ return r.kind === "item" && Number(r.amount) > 0; }).length;
    var h = '<div class="bd-line"><span>Items ('+nItems+')</span><span>'+esc(money(t.item, cur))+'</span></div>';
    if(candidates.expectedItems) h += nItems === candidates.expectedItems
      ? '<div class="bd-check ok">✓ '+nItems+' items — same as the receipt says</div>'
      : '<div class="bd-check bad">Receipt says '+candidates.expectedItems+' items, '+nItems+' found here — something may be missing or split.</div>';
    if(t.charge) h += '<div class="bd-line"><span>Tax / service</span><span>+ '+esc(money(t.charge, cur))+'</span></div>';
    if(t.discount) h += '<div class="bd-line"><span>Discount</span><span>− '+esc(money(t.discount, cur))+'</span></div>';
    h += '<div class="bd-line bd-total"><span>Total</span><span>'+esc(money(t.total, cur))+'</span></div>';
    if(receiptSubtotal != null){
      var sd = round2(t.item - receiptSubtotal);
      if(Math.abs(sd) >= 1) h += '<div class="bd-check bad">Items add up to '+esc(money(t.item, cur))+' but the receipt sub-total says '+esc(money(receiptSubtotal, cur))+' — an item price is probably misread.</div>';
      else h += '<div class="bd-check ok">✓ Items match the receipt sub-total</div>';
    }
    if(receiptTotal != null){
      var diff = round2(t.total - receiptTotal);
      h += Math.abs(diff) < 1 ? '<div class="bd-check ok">✓ Matches the receipt total ('+esc(money(receiptTotal, cur))+')</div>'
        : '<div class="bd-check bad">Receipt total reads '+esc(money(receiptTotal, cur))+' — off by '+esc(money(Math.abs(diff), cur))+'. Check the amounts against the photo.</div>';
    }
    return h;
  }

  openSheetHtml(
    '<h3>Check the receipt</h3>'+
    (candidates.photoUrl ? '<img class="rc-photo" id="rc-photo" src="'+esc(candidates.photoUrl)+'" alt="Receipt photo">'+
      '<div class="muted" style="font-size:11.5px;margin:4px 0 10px;text-align:center;">Tap the photo to enlarge</div>' : '')+
    '<p class="muted" style="font-size:12.5px;line-height:1.5;margin:0 0 10px;">Fix any name or amount the scanner got wrong. Tap the label to switch a line between <b>Item</b>, <b>Tax / service</b>, <b>Discount</b> or <b>Skip</b>.</p>'+
    '<div id="rc-list"></div>'+
    '<button class="btn btn-ghost btn-sm" id="rc-add" style="margin:4px 0 10px;">+ Add a missed line</button>'+
    '<div class="breakdown" id="rc-sum"></div>'+
    '<div class="sheet-actions">'+
      '<button class="btn btn-ghost" id="cand-back">Back</button>'+
      '<button class="btn btn-brand" id="cand-add">Add to bill</button>'+
    '</div>',
    function(el){
      function refreshSum(){ el.querySelector("#rc-sum").innerHTML = summaryHtml(); }
      function renderRows(){
        var nSkipped = rows.filter(function(r){ return r.kind === "ignore" && !r.isTotal && !r.userSkipped; }).length;
        el.querySelector("#rc-list").innerHTML = rows.map(rowHtml).join("") +
          (nSkipped ? '<button class="rc-toggle" id="rc-toggle">'+(showSkipped ? "Hide" : "Show")+' '+nSkipped+' skipped line'+(nSkipped===1?"":"s")+'</button>' : '');
        var tg = el.querySelector("#rc-toggle");
        if(tg) tg.addEventListener("click", function(){ showSkipped = !showSkipped; renderRows(); });
        el.querySelectorAll('[data-role="rc-kind"]').forEach(function(b){
          b.addEventListener("click", function(){
            var r = rows[+b.dataset.i];
            r.kind = RC_KINDS[(RC_KINDS.indexOf(r.kind) + 1) % RC_KINDS.length];
            if(r.kind === "ignore") r.userSkipped = true;   // stays visible so it can be switched back
            renderRows();
          });
        });
        el.querySelectorAll('[data-role="rc-desc"]').forEach(function(i){
          i.addEventListener("input", function(){ rows[+i.dataset.i].desc = i.value; });
        });
        el.querySelectorAll('[data-role="rc-amt"]').forEach(function(i){
          i.addEventListener("input", function(){
            var r = rows[+i.dataset.i];
            r.warn = false;
            r.amount = parseFloat(i.value) || 0;
            if(r.isTotal) receiptTotal = r.amount || null;   // correcting a misread total
            refreshSum();
          });
        });
        refreshSum();
      }
      renderRows();
      var ph = el.querySelector("#rc-photo");
      if(ph) ph.addEventListener("click", function(){ ph.classList.toggle("big"); });
      el.querySelector("#rc-add").addEventListener("click", function(){
        rows.push({ desc:"", amount:"", kind:"item", pct:null });
        renderRows();
        var ins = el.querySelectorAll('[data-role="rc-desc"]'); if(ins.length) ins[ins.length-1].focus();
      });
      el.querySelector("#cand-back").addEventListener("click", function(){ closeSheet(); if(onBack) onBack(); });
      el.querySelector("#cand-add").addEventListener("click", function(){
        var ok = rows.filter(function(r){ return !r.isTotal && r.kind !== "ignore" && Number(r.amount) > 0 && String(r.desc).trim(); });
        var items = ok.filter(function(r){ return r.kind === "item"; }).map(function(r){ return { desc: cleanText(r.desc, MAX_DESC_LEN), amount: round2(r.amount) }; });
        if(!items.length){ toast("Mark at least one line as an Item", true); return; }
        var extras = ok.filter(function(r){ return r.kind !== "item"; }).map(function(r){ return { desc: cleanText(r.desc, MAX_DESC_LEN), amount: round2(r.amount), kind: r.kind, pct: r.pct }; });
        closeSheet();
        onConfirm({ items: items, extras: extras, receiptTotal: receiptTotal });
      });
    },
    onBack
  );
}

/* ---- Bill sheet ---- */

var draftSplit = [], draftPaidBy = "", draftCat = "other", draftMode = "equal";
var draftAmounts = {}, draftShares = {};
var draftItems = []; // itemized mode: [{ localId, desc, amount, people:[email], mode:"equal"|"percent", percents:{} }]
var draftItemSeq = 0;
// Tax / service / discount lines on an itemized bill, in the bill's currency.
// mode "amount": value is the amount; mode "percent": value is % of the items subtotal.
var draftExtras = [], draftExtraSeq = 0, draftReceiptTotal = null;
function newDraftExtra(desc, kind, mode, value, pct){
  draftExtraSeq++;
  return { localId:"x"+draftExtraSeq, desc:desc||"", kind: kind === "discount" ? "discount" : "charge",
           mode: mode === "percent" ? "percent" : "amount", value: value || "", pct: pct != null ? pct : null };
}
var draftDesc = "";
var draftAmountText = null;   // typed amount kept across a receipt scan
var draftCurrency = "INR", draftBillDate = "", draftFx = { rate:null, source:"day", date:null };
var fxToken = 0;

/** During the trip dates new bills start in LKR; before/after, in ₹. */
function defaultCurrency(){ return isDuringTrip() ? "LKR" : "INR"; }

function newDraftItem(desc, amount){
  draftItemSeq++;
  return { localId:"it"+draftItemSeq, desc:desc||"", amount:amount||0, people:S.people.map(function(p){return p.email;}), mode:"equal", percents:{} };
}

function openBillSheet(existing, resumeDraft, autoScan){
  if(!S.people.length){ toast("Join the trip first", true); return; }
  fxToken++;   // any rate lookup still running for a previous sheet is now void
  if(!resumeDraft){
    draftAmountText = null;
    draftSplit = existing ? existing.split.slice() : S.people.map(function(p){ return p.email; });
    draftPaidBy = existing ? existing.paidBy : S.me;
    draftCat = existing ? existing.category : "other";
    draftMode = existing ? (existing.splitMode || "equal") : "equal";
    draftAmounts = existing && existing.splitAmounts ? Object.assign({}, existing.splitAmounts) : {};
    draftShares = existing && existing.splitShares ? Object.assign({}, existing.splitShares) : {};
    draftItemSeq = 0;
    draftCurrency = existing ? (existing.currency || "INR") : defaultCurrency();
    draftBillDate = (existing && existing.billDate) ? existing.billDate : todayYmd();
    draftFx = (existing && existing.fx) ? Object.assign({}, existing.fx)
            : { rate:null, source: (lsGet("pw_last_fxsrc") === "airport" ? "airport" : "day"), date:null };
    draftItems = (existing && existing.items) ? existing.items.map(function(it){
      draftItemSeq++;
      var shown = (draftCurrency === "LKR" && Number(it.origAmount) > 0) ? Number(it.origAmount) : it.amount;
      return { localId:"it"+draftItemSeq, desc:it.desc, amount:shown, people:(it.people||[]).slice(), mode:it.mode||"equal", percents:Object.assign({},it.percents||{}) };
    }) : [];
    draftExtraSeq = 0;
    draftExtras = (existing && existing.extras) ? existing.extras.map(function(x){
      var shown = (draftCurrency === "LKR" && Number(x.origAmount) > 0) ? Number(x.origAmount) : x.amount;
      return newDraftExtra(x.desc, x.kind, "amount", shown, x.pct);
    }) : [];
    draftReceiptTotal = null;
  }
  /** Formats an amount in the bill's own currency (what's being typed). */
  function cm(v){ return money(v, draftCurrency); }
  var curChips = [["INR","₹ Indian"],["LKR","Rs Sri Lankan"]].map(function(c){
    return '<div class="chip'+(draftCurrency===c[0]?" on":"")+'" data-role="cur" data-id="'+c[0]+'">'+c[1]+'</div>';
  }).join("");

  var payChips = S.people.map(function(p){
    return '<div class="chip'+(draftPaidBy===p.email?" on":"")+'" data-role="paid" data-id="'+esc(p.email)+'">'+esc(p.name)+'</div>';
  }).join("");
  var catChips = CATEGORIES.map(function(c){
    return '<div class="chip'+(draftCat===c.id?" on":"")+'" data-role="cat" data-id="'+c.id+'">'+c.icon+' '+c.label+'</div>';
  }).join("");
  var modeChips = [["equal","Equal"],["exact","Exact amounts"],["shares","Shares"],["itemized","By item"]].map(function(m){
    return '<div class="chip'+(draftMode===m[0]?" on":"")+'" data-role="mode" data-id="'+m[0]+'">'+m[1]+'</div>';
  }).join("");

  function renderSplitSection(){
    if(draftMode === "equal"){
      return '<div class="chip-grid" id="b-split-chips">'+S.people.map(function(p){
        return '<div class="chip'+(draftSplit.indexOf(p.email)>=0?" on":"")+'" data-role="split" data-id="'+esc(p.email)+'">'+esc(p.name)+'</div>';
      }).join("")+'</div><div class="split-hint" id="b-hint"></div>';
    }
    // exact or shares: a per-person row with an input, checkbox baked into inclusion
    if(draftMode === "shares"){
      draftSplit.forEach(function(e){ if(draftShares[e] == null || draftShares[e] === "") draftShares[e] = 1; });
    }
    var rows = S.people.map(function(p){
      var included = draftSplit.indexOf(p.email) >= 0;
      var val = draftMode==="exact" ? (draftAmounts[p.email]!=null?draftAmounts[p.email]:"") : (draftShares[p.email]!=null?draftShares[p.email]:(included?1:""));
      return '<div class="split-row" data-person="'+esc(p.email)+'">'+
        '<div class="chip'+(included?" on":"")+'" data-role="split" data-id="'+esc(p.email)+'" style="flex:1;text-align:left;">'+esc(p.name)+'</div>'+
        '<input type="number" inputmode="decimal" class="split-input" data-role="'+draftMode+'-input" data-id="'+esc(p.email)+'" '+
          'style="width:84px;'+(included?"":"opacity:.4;")+'" placeholder="'+(draftMode==="exact"?"0":"1")+'" value="'+esc(val)+'" '+(included?"":"disabled")+'>'+
        '</div>';
    }).join("");
    return '<div id="b-split-chips">'+rows+'</div><div class="split-hint" id="b-hint"></div>';
  }

  function itemTotal(){ return round2(draftItems.reduce(function(s,it){ return s+(Number(it.amount)||0); },0)); }
  function extraAmount(x){
    var v = Number(x.value) || 0;
    return round2(x.mode === "percent" ? itemTotal() * v / 100 : v);
  }
  function resolvedExtras(){
    return draftExtras.map(function(x){
      return { desc: x.desc, kind: x.kind, amount: extraAmount(x), pct: x.mode === "percent" ? Number(x.value)||null : x.pct };
    }).filter(function(x){ return x.amount > 0; });
  }
  function grandTotal(){
    return round2(resolvedExtras().reduce(function(s,x){ return s + (x.kind === "discount" ? -x.amount : x.amount); }, itemTotal()));
  }
  /** Per-person amounts (bill currency) using the exact same maths as the balances. */
  function draftPerPerson(){
    var tmp = { splitMode:"itemized", items: draftItems.filter(function(it){ return Number(it.amount) > 0 && it.people.length; }).map(function(it){
      return { amount: round2(it.amount), people: it.people, mode: it.mode, percents: it.percents };
    }), extras: resolvedExtras() };
    var p = billSharesPaise(tmp), out = {};
    Object.keys(p).forEach(function(e){ out[e] = p[e]/100; });
    return out;
  }
  function renderExtrasSection(){
    var rows = draftExtras.map(function(x){
      var isD = x.kind === "discount";
      return '<div class="x-row" data-extra="'+x.localId+'">'+
        '<div style="display:flex;gap:6px;align-items:center;">'+
          '<button class="chip x-kind'+(isD?' disc':'')+'" data-role="x-kind" data-x="'+x.localId+'">'+(isD ? "− Discount" : "+ Tax / service")+'</button>'+
          '<input type="text" class="split-input" data-role="x-desc" data-x="'+x.localId+'" style="flex:1;min-width:0;" maxlength="80" value="'+esc(x.desc)+'" placeholder="'+(isD?"Discount":"Service charge / VAT")+'">'+
          '<button class="btn btn-line btn-sm" data-role="x-del" data-x="'+x.localId+'" style="padding:6px 9px;">✕</button>'+
        '</div>'+
        '<div style="display:flex;gap:6px;align-items:center;margin-top:6px;">'+
          '<input type="number" inputmode="decimal" class="split-input" data-role="x-val" data-x="'+x.localId+'" style="width:124px;" value="'+esc(x.value)+'" placeholder="'+(x.mode==="percent"?"%":"0")+'">'+
          '<button class="btn btn-ghost btn-sm" data-role="x-mode" data-x="'+x.localId+'" style="padding:6px 10px;">'+(x.mode==="percent" ? "% of items" : "amount")+'</button>'+
          '<span class="muted" data-role="x-res" data-x="'+x.localId+'" style="font-size:12.5px;margin-left:auto;"></span>'+
        '</div>'+
      '</div>';
    }).join("");
    return '<div class="extras-box">'+
      '<div class="extras-head">Tax, service &amp; discounts</div>'+
      '<div class="muted" style="font-size:12px;margin:-2px 0 8px;">Shared in proportion to what each person had — not split equally.</div>'+
      rows+
      '<div style="display:flex;gap:8px;margin-top:6px;">'+
        '<button class="btn btn-ghost btn-sm" id="b-add-charge">+ Tax / service</button>'+
        '<button class="btn btn-ghost btn-sm" id="b-add-discount">− Discount</button>'+
      '</div></div>';
  }

  function renderItemsSection(){
    if(!draftItems.length){
      return '<div class="empty" style="padding:20px 10px;"><span class="big">🧾</span>No items yet<br>Scan a receipt or add items by hand.</div>';
    }
    return draftItems.map(function(it){
      var peopleChips = S.people.map(function(p){
        var on = it.people.indexOf(p.email)>=0;
        return '<div class="chip'+(on?" on":"")+'" style="padding:6px 10px;font-size:12px;" data-role="item-person" data-item="'+it.localId+'" data-id="'+esc(p.email)+'">'+esc(p.name)+'</div>';
      }).join("");
      var modeToggle = '<button class="btn btn-ghost btn-sm" data-role="item-mode-toggle" data-item="'+it.localId+'" style="padding:5px 9px;font-size:11px;">'+(it.mode==="percent"?"% split":"Equal split")+'</button>';
      var percentRow = "";
      if(it.mode==="percent"){
        var pctSum = 0; it.people.forEach(function(e){ pctSum += Number(it.percents[e])||0; });
        percentRow = '<div style="margin-top:8px;">'+it.people.map(function(e){
          return '<div class="split-row"><span style="flex:1;font-size:12.5px;">'+esc(pName(e))+'</span>'+
            '<input type="number" inputmode="decimal" class="split-input" data-role="item-percent" data-item="'+it.localId+'" data-id="'+esc(e)+'" style="width:64px;" value="'+esc(it.percents[e]!=null?it.percents[e]:"")+'" placeholder="%"></div>';
        }).join("")+'<div class="split-hint">'+Math.round(pctSum)+'% of '+cm(it.amount)+'</div></div>';
      }
      return '<div class="card" style="padding:12px 14px;margin-bottom:8px;" data-item-card="'+it.localId+'">'+
        '<div style="display:flex;gap:8px;align-items:center;">'+
          '<input type="text" class="split-input" data-role="item-desc" data-item="'+it.localId+'" style="flex:1;" maxlength="80" value="'+esc(it.desc)+'" placeholder="Item name">'+
          '<div class="amount-field" style="width:104px;"><span class="rupee cur-sym">'+curSymbol(draftCurrency)+'</span>'+
            '<input type="number" inputmode="decimal" class="split-input" data-role="item-amount" data-item="'+it.localId+'" style="width:100%;padding-left:30px;" value="'+esc(it.amount||"")+'" placeholder="0"></div>'+
          '<button class="btn btn-line btn-sm" data-role="item-del" data-item="'+it.localId+'" style="padding:6px 9px;">✕</button>'+
        '</div>'+
        '<div class="chip-grid" style="margin-top:8px;">'+peopleChips+'</div>'+
        '<div style="margin-top:8px;">'+modeToggle+'</div>'+
        percentRow+
      '</div>';
    }).join("") + renderExtrasSection() +
      '<div class="breakdown" id="b-items-total"></div>';
  }

  // Firestore rules only let the person who added a bill change or delete it.
  var readOnly = !!(existing && existing.addedBy !== S.me);

  openSheetHtml(
    '<h3>'+(readOnly ? "Bill details" : (existing?"Edit bill":"Add a bill"))+'</h3>'+
    (readOnly ? '' : '<button class="btn btn-brand btn-wide scan-cta" id="b-scan-top">📷 Scan bill — fills in items &amp; prices</button>')+
    (readOnly ? '<div class="day-tip" style="margin:-4px 0 12px;font-style:normal;">'+(existing.addedBy ? 'Added by '+esc(pName(existing.addedBy))+' — only they can change or delete it.' : 'This bill can\'t be edited.')+'</div>' : '')+
    '<div class="field"><label>What was it for</label>'+
      '<input type="text" id="b-desc" maxlength="80" placeholder="e.g. Dinner in Ella" value="'+esc(resumeDraft ? draftDesc : (existing ? existing.desc : ""))+'"></div>'+
    '<div style="display:flex;gap:10px;">'+
      '<div class="field" style="flex:0 0 42%;"><label>Date</label><input type="date" id="b-date" value="'+esc(draftBillDate)+'" max="'+esc(dateToYmd(addDays(new Date(),1)))+'"></div>'+
      '<div class="field" style="flex:1;"><label>Paid in</label><div class="chip-grid">'+curChips+'</div></div>'+
    '</div>'+
    '<div class="fx-box" id="b-fx" style="display:'+(draftCurrency==="LKR"?"block":"none")+';">'+
      '<div class="chip-grid" style="margin-bottom:8px;">'+
        '<div class="chip" data-role="fxsrc" data-id="day">📈 That day\'s rate</div>'+
        '<div class="chip" data-role="fxsrc" data-id="airport">🛫 Airport rate</div>'+
      '</div>'+
      '<div class="fx-line">₹1 = <input type="number" inputmode="decimal" step="0.01" id="b-rate" class="split-input" style="width:84px;" placeholder="3.45"> LKR</div>'+
      '<div class="split-hint" id="b-fx-note"></div>'+
    '</div>'+
    '<div class="field" id="b-amount-field" style="display:'+(draftMode==="itemized"?"none":"block")+';"><label>Amount</label><div class="amount-field"><span class="rupee cur-sym">'+curSymbol(draftCurrency)+'</span>'+
      '<input type="number" inputmode="decimal" id="b-amount" placeholder="0" value="'+esc(resumeDraft && draftAmountText != null ? draftAmountText : (existing ? (existing.currency==="LKR" && existing.origAmount ? existing.origAmount : existing.amount) : ""))+'"></div><div class="split-hint" id="b-conv"></div></div>'+
    '<div class="field"><label>Category</label><div class="chip-grid">'+catChips+'</div></div>'+
    '<div class="field"><label>Who paid</label><div class="chip-grid">'+payChips+'</div></div>'+
    '<div class="field"><label>Split</label><div class="chip-grid" style="margin-bottom:10px;">'+modeChips+'</div>'+
      '<div id="b-split-wrap">'+(draftMode==="itemized" ? "" : renderSplitSection())+'</div>'+
      '<div id="b-items-wrap" style="display:'+(draftMode==="itemized"?"block":"none")+';">'+
        '<div style="display:flex;gap:8px;margin-bottom:10px;">'+
          '<button class="btn btn-ghost btn-sm" id="b-scan-receipt">📷 Scan receipt</button>'+
          '<button class="btn btn-ghost btn-sm" id="b-add-item">+ Add item</button>'+
        '</div>'+
        '<input type="file" id="b-receipt-input" accept="image/*" style="display:none;">'+
        '<div id="b-items-list">'+renderItemsSection()+'</div>'+
      '</div>'+
    '</div>'+
    (readOnly
      ? '<div class="sheet-actions"><button class="btn btn-ghost" id="b-close">Close</button></div>'
      : '<div class="sheet-actions">'+
          (existing?'<button class="btn btn-line" id="b-del">Delete</button>':'')+
          '<button class="btn btn-brand" id="b-save">'+(existing?"Save changes":"Save bill")+'</button>'+
        '</div>'),
    function(el){
      function amt(){ return parseFloat(el.querySelector("#b-amount").value) || 0; }

      /* ---- currency / exchange rate ---- */
      var fxStatus = validRate(draftFx.rate) ? "ok" : "none";

      function updateConv(){
        var total = draftMode === "itemized" ? grandTotal() : amt();
        // ₹ shown = sum of each line converted, exactly as it will be saved.
        var inrTotal = null;
        if(draftCurrency === "LKR" && validRate(draftFx.rate)){
          if(draftMode === "itemized"){
            inrTotal = draftItems.reduce(function(s,it){ return round2(s + (Number(it.amount) > 0 ? lkrToInr(it.amount, draftFx.rate) : 0)); }, 0);
            resolvedExtras().forEach(function(x){ inrTotal = round2(inrTotal + (x.kind==="discount" ? -1 : 1) * lkrToInr(x.amount, draftFx.rate)); });
          } else inrTotal = lkrToInr(total, draftFx.rate);
        }
        var txt = "";
        if(draftCurrency === "LKR"){
          txt = inrTotal != null ? ("= " + inr(inrTotal) + " at ₹1 = " + draftFx.rate + " LKR") : "Waiting for the exchange rate…";
        }
        var c = el.querySelector("#b-conv"); if(c) c.textContent = txt;
        var t = el.querySelector("#b-items-total");
        if(t && draftMode === "itemized"){
          var sub = itemTotal(), ex = resolvedExtras(), html = '<div class="bd-line"><span>Items</span><span>'+esc(cm(sub))+'</span></div>';
          ex.forEach(function(x){
            html += '<div class="bd-line"><span>'+esc(x.desc || (x.kind==="discount"?"Discount":"Tax / service"))+'</span><span>'+(x.kind==="discount"?"− ":"+ ")+esc(cm(x.amount))+'</span></div>';
          });
          html += '<div class="bd-line bd-total"><span>Total</span><span>'+esc(cm(total))+
            (inrTotal != null ? ' <span class="muted" style="font-weight:500;">= '+esc(inr(inrTotal))+'</span>' : '')+'</span></div>';
          if(draftReceiptTotal != null){
            var diff = round2(total - draftReceiptTotal);
            html += Math.abs(diff) < 1
              ? '<div class="bd-check ok">✓ Matches the receipt total</div>'
              : '<div class="bd-check bad">Receipt total reads '+esc(cm(draftReceiptTotal))+' — '+esc(cm(Math.abs(diff)))+(diff>0?' more':' less')+' here. Check the lines against the paper.</div>';
          }
          var per = draftPerPerson(), names = Object.keys(per).filter(function(e){ return per[e] > 0; });
          if(names.length){
            html += '<div class="bd-head">Each person pays</div>' + names.map(function(e){
              return '<div class="bd-line"><span>'+esc(pName(e))+'</span><span>'+esc(cm(per[e]))+'</span></div>';
            }).join("");
          }
          t.innerHTML = html;
          draftExtras.forEach(function(x){
            var r = el.querySelector('[data-role="x-res"][data-x="'+x.localId+'"]');
            if(r) r.textContent = x.mode === "percent" ? "= " + cm(extraAmount(x)) : "";
          });
        }
      }

      function updateFxUI(){
        el.querySelector("#b-fx").style.display = draftCurrency === "LKR" ? "block" : "none";
        el.querySelectorAll('[data-role="cur"]').forEach(function(x){ x.classList.toggle("on", x.dataset.id === draftCurrency); });
        el.querySelectorAll('[data-role="fxsrc"]').forEach(function(x){ x.classList.toggle("on", x.dataset.id === draftFx.source); });
        el.querySelectorAll(".cur-sym").forEach(function(x){ x.textContent = curSymbol(draftCurrency); });
        var rateIn = el.querySelector("#b-rate");
        if(document.activeElement !== rateIn) rateIn.value = validRate(draftFx.rate) ? draftFx.rate : "";
        var note = "";
        if(fxStatus === "loading") note = "Getting the rate for " + fmtYmdShort(draftBillDate) + "…";
        else if(fxStatus === "noairport") note = "No airport rate saved yet — add it in ⚙️ Trip settings (Plan tab), or type the rate above.";
        else if(fxStatus === "error") note = "Couldn't get the rate (no signal?). Type it above, or save an airport rate in Trip settings.";
        else if(fxStatus === "fellback") note = "No signal for the day's rate — using your airport rate instead.";
        else if(draftFx.source === "day" && validRate(draftFx.rate)) note = "Market rate for " + fmtYmdShort(draftFx.date) + ".";
        else if(draftFx.source === "airport" && validRate(draftFx.rate)) note = "Your group's airport rate.";
        else if(draftFx.source === "manual") note = "Rate typed in by hand.";
        el.querySelector("#b-fx-note").textContent = note;
        updateConv();
        hint();
      }

      function resolveRate(){
        if(draftCurrency !== "LKR"){ updateFxUI(); return; }
        var token = ++fxToken;
        if(draftFx.source === "airport"){
          if(validRate(S.settings.airportRate)){ draftFx = { rate:S.settings.airportRate, source:"airport", date:draftBillDate }; fxStatus = "ok"; }
          else { draftFx.rate = null; fxStatus = "noairport"; }
          updateFxUI(); return;
        }
        if(draftFx.source === "manual"){ fxStatus = validRate(draftFx.rate) ? "ok" : "none"; updateFxUI(); return; }
        fxStatus = "loading"; updateFxUI();
        fetchLkrPerInr(draftBillDate).then(function(r){
          if(token !== fxToken || openSheetEl !== el) return;
          draftFx = { rate:r.rate, source:"day", date:r.date }; fxStatus = "ok"; updateFxUI();
        }).catch(function(){
          if(token !== fxToken || openSheetEl !== el) return;
          if(validRate(S.settings.airportRate)){ draftFx = { rate:S.settings.airportRate, source:"airport", date:draftBillDate }; fxStatus = "fellback"; }
          else { draftFx = { rate:null, source:"day", date:null }; fxStatus = "error"; }
          updateFxUI();
        });
      }

      el.querySelectorAll('[data-role="cur"]').forEach(function(c){
        c.addEventListener("click", function(){
          if(c.dataset.id === draftCurrency) return;
          fxToken++;
          var typed = el.querySelector("#b-amount").value;
          draftCurrency = c.dataset.id;
          if(typed) toast("Amount "+typed+" is now in "+(draftCurrency === "LKR" ? "LKR" : "₹")+" — check it's right");
          if(draftCurrency === "LKR" && !validRate(draftFx.rate)) resolveRate(); else updateFxUI();
        });
      });
      el.querySelectorAll('[data-role="fxsrc"]').forEach(function(c){
        c.addEventListener("click", function(){ draftFx = { rate:null, source:c.dataset.id, date:null }; resolveRate(); });
      });
      el.querySelector("#b-rate").addEventListener("input", function(){
        var v = parseFloat(this.value);
        fxToken++;   // typing a rate beats any lookup still in flight
        draftFx = { rate: validRate(v) ? Math.round(v*10000)/10000 : null, source:"manual", date:draftBillDate };
        fxStatus = validRate(v) ? "ok" : "none";
        el.querySelectorAll('[data-role="fxsrc"]').forEach(function(x){ x.classList.remove("on"); });
        el.querySelector("#b-fx-note").textContent = validRate(v) ? "Rate typed in by hand." : "Enter LKR for ₹1, e.g. 3.45";
        updateConv(); hint();
      });
      el.querySelector("#b-date").addEventListener("change", function(){
        if(!ymdToDate(this.value)) return;
        draftBillDate = this.value;
        if(draftCurrency === "LKR" && draftFx.source === "day") resolveRate();
      });

      function hint(){
        var h = el.querySelector("#b-hint");
        if(!h) return;
        if(!draftSplit.length){ h.textContent = "Pick at least one person"; return; }
        if(draftMode === "equal"){
          h.textContent = draftSplit.length+" people · "+cm(amt()/draftSplit.length)+" each";
        } else if(draftMode === "exact"){
          var sum = 0; draftSplit.forEach(function(e){ sum += Number(draftAmounts[e])||0; });
          var diff = round2(amt() - sum);
          h.textContent = cm(sum)+" of "+cm(amt())+" assigned"+(Math.abs(diff)>0.01?" · "+(diff>0?cm(diff)+" left over":cm(-diff)+" over"):" · ✓ matches");
        } else {
          var totalW = 0; draftSplit.forEach(function(e){ totalW += Number(draftShares[e])||0; });
          if(totalW<=0){ h.textContent = "Give at least one share"; return; }
          var parts = draftSplit.map(function(e){
            var w = Number(draftShares[e])||0;
            return pName(e)+" "+cm(amt()*(w/totalW));
          });
          h.textContent = parts.join(" · ");
        }
      }

      function rebuildSplitSection(){
        el.querySelector("#b-split-wrap").innerHTML = renderSplitSection();
        wireSplitSection();
        hint();
      }

      function rebuildItemsSection(){
        el.querySelector("#b-items-list").innerHTML = renderItemsSection();
        wireItemsSection();
        updateConv();
      }

      function findX(id){ return draftExtras.filter(function(x){ return x.localId === id; })[0]; }
      function wireExtras(){
        el.querySelectorAll('[data-role="x-kind"]').forEach(function(b){ b.addEventListener("click", function(){
          var x = findX(b.dataset.x); if(!x) return; x.kind = x.kind === "discount" ? "charge" : "discount"; rebuildItemsSection(); }); });
        el.querySelectorAll('[data-role="x-mode"]').forEach(function(b){ b.addEventListener("click", function(){
          var x = findX(b.dataset.x); if(!x) return; x.mode = x.mode === "percent" ? "amount" : "percent"; x.value = ""; rebuildItemsSection(); }); });
        el.querySelectorAll('[data-role="x-del"]').forEach(function(b){ b.addEventListener("click", function(){
          draftExtras = draftExtras.filter(function(x){ return x.localId !== b.dataset.x; }); rebuildItemsSection(); }); });
        el.querySelectorAll('[data-role="x-desc"]').forEach(function(i){ i.addEventListener("input", function(){
          var x = findX(i.dataset.x); if(x){ x.desc = i.value; updateConv(); } }); });
        el.querySelectorAll('[data-role="x-val"]').forEach(function(i){ i.addEventListener("input", function(){
          var x = findX(i.dataset.x); if(x){ x.value = i.value; updateConv(); } }); });
        var ac = el.querySelector("#b-add-charge"), ad = el.querySelector("#b-add-discount");
        if(ac) ac.addEventListener("click", function(){ draftExtras.push(newDraftExtra("Service charge", "charge", "percent", "")); rebuildItemsSection(); });
        if(ad) ad.addEventListener("click", function(){ draftExtras.push(newDraftExtra("Discount", "discount", "amount", "")); rebuildItemsSection(); });
      }

      function wireItemsSection(){
        wireExtras();
        el.querySelectorAll('[data-role="item-desc"]').forEach(function(inp){
          inp.addEventListener("input", function(){
            var it = draftItems.filter(function(x){return x.localId===inp.dataset.item;})[0];
            if(it) it.desc = inp.value;
          });
        });
        el.querySelectorAll('[data-role="item-amount"]').forEach(function(inp){
          inp.addEventListener("input", function(){
            var it = draftItems.filter(function(x){return x.localId===inp.dataset.item;})[0];
            if(it) it.amount = parseFloat(inp.value)||0;
            updateConv();
          });
        });
        el.querySelectorAll('[data-role="item-person"]').forEach(function(c){
          c.addEventListener("click", function(){
            var it = draftItems.filter(function(x){return x.localId===c.dataset.item;})[0];
            if(!it) return;
            var idx = it.people.indexOf(c.dataset.id);
            if(idx>=0){ if(it.people.length>1) it.people.splice(idx,1); }
            else it.people.push(c.dataset.id);
            rebuildItemsSection();
          });
        });
        el.querySelectorAll('[data-role="item-mode-toggle"]').forEach(function(btn){
          btn.addEventListener("click", function(){
            var it = draftItems.filter(function(x){return x.localId===btn.dataset.item;})[0];
            if(!it) return;
            it.mode = it.mode==="percent" ? "equal" : "percent";
            if(it.mode==="percent" && !Object.keys(it.percents).length){
              var even = round2(100/it.people.length);
              it.people.forEach(function(e){ it.percents[e]=even; });
            }
            rebuildItemsSection();
          });
        });
        el.querySelectorAll('[data-role="item-percent"]').forEach(function(inp){
          inp.addEventListener("input", function(){
            var it = draftItems.filter(function(x){return x.localId===inp.dataset.item;})[0];
            if(!it) return;
            it.percents[inp.dataset.id] = parseFloat(inp.value)||0;
            var sumPct = 0; it.people.forEach(function(e){ sumPct += Number(it.percents[e])||0; });
            updateConv();
            var hintEl = el.querySelector('[data-item-card="'+it.localId+'"] .split-hint');
            if(hintEl){
              hintEl.textContent = Math.round(sumPct*100)/100 + '% of ' + cm(it.amount) + (Math.abs(sumPct-100) <= 0.5 ? " ✓" : " — needs to total 100%");
            }
          });
        });
        el.querySelectorAll('[data-role="item-del"]').forEach(function(btn){
          btn.addEventListener("click", function(){
            draftItems = draftItems.filter(function(x){return x.localId!==btn.dataset.item;});
            rebuildItemsSection();
          });
        });
      }

      function wireSplitSection(){
        el.querySelectorAll('[data-role="split"]').forEach(function(c){
          c.addEventListener("click", function(){
            var id = c.dataset.id, i = draftSplit.indexOf(id);
            if(i>=0){ if(draftSplit.length>1) draftSplit.splice(i,1); }
            else { draftSplit.push(id); if(draftMode==="shares" && draftShares[id]==null) draftShares[id]=1; }
            rebuildSplitSection();
          });
        });
        el.querySelectorAll('[data-role="exact-input"]').forEach(function(inp){
          inp.addEventListener("input", function(){
            draftAmounts[inp.dataset.id] = parseFloat(inp.value)||0;
            hint();
          });
        });
        el.querySelectorAll('[data-role="shares-input"]').forEach(function(inp){
          inp.addEventListener("input", function(){
            draftShares[inp.dataset.id] = parseFloat(inp.value)||0;
            hint();
          });
        });
      }

      wireSplitSection();
      hint();
      el.querySelector("#b-amount").addEventListener("input", function(){ hint(); updateConv(); });
      if(draftCurrency === "LKR" && !validRate(draftFx.rate)) resolveRate(); else updateFxUI();

      el.querySelectorAll('[data-role="paid"]').forEach(function(c){
        c.addEventListener("click", function(){
          draftPaidBy = c.dataset.id;
          el.querySelectorAll('[data-role="paid"]').forEach(function(x){
            x.classList.toggle("on", x.dataset.id===draftPaidBy);
          });
        });
      });
      el.querySelectorAll('[data-role="cat"]').forEach(function(c){
        c.addEventListener("click", function(){
          draftCat = c.dataset.id;
          el.querySelectorAll('[data-role="cat"]').forEach(function(x){
            x.classList.toggle("on", x.dataset.id===draftCat);
          });
        });
      });
      el.querySelectorAll('[data-role="mode"]').forEach(function(c){
        c.addEventListener("click", function(){
          draftMode = c.dataset.id;
          el.querySelectorAll('[data-role="mode"]').forEach(function(x){
            x.classList.toggle("on", x.dataset.id===draftMode);
          });
          var isItemized = draftMode==="itemized";
          el.querySelector("#b-amount-field").style.display = isItemized ? "none" : "block";
          el.querySelector("#b-split-wrap").style.display = isItemized ? "none" : "block";
          el.querySelector("#b-items-wrap").style.display = isItemized ? "block" : "none";
          if(isItemized){
            if(!draftItems.length) draftItems.push(newDraftItem("", amt()||0));
            rebuildItemsSection();
          } else {
            rebuildSplitSection();
          }
        });
      });

      wireItemsSection();

      var addItemBtn = el.querySelector("#b-add-item");
      if(addItemBtn) addItemBtn.addEventListener("click", function(){
        draftItems.push(newDraftItem("",0));
        rebuildItemsSection();
      });

      var scanBtn = el.querySelector("#b-scan-receipt");
      var receiptInput = el.querySelector("#b-receipt-input");
      if(scanBtn) scanBtn.addEventListener("click", function(){ receiptInput.click(); });
      var scanTop = el.querySelector("#b-scan-top");
      if(scanTop) scanTop.addEventListener("click", function(){ receiptInput.click(); });
      if(autoScan && receiptInput) receiptInput.click();
      if(receiptInput) receiptInput.addEventListener("change", function(){
        var file = receiptInput.files && receiptInput.files[0];
        if(!file) return;
        var sheetForScan = el;
        scanReceiptImage(file, (scanTop && scanTop.offsetParent) ? scanTop : scanBtn).then(function(lines){
          if(openSheetEl !== sheetForScan){ toast("Receipt scan discarded — that bill was closed"); return; }
          if(!lines.length){ toast("Couldn't read any prices — try a flat, well-lit photo, or add items by hand", true); return; }
          // The review sheet temporarily replaces this bill sheet (one sheet
          // at a time). Remember what's been typed so far, then reopen the
          // bill sheet with it intact — whether they add items or go back.
          draftDesc = el.querySelector("#b-desc").value;
          draftAmountText = el.querySelector("#b-amount").value;
          var existingSnapshot = existing;
          var prevCurrency = draftCurrency;
          if(lines.lkr) draftCurrency = "LKR";   // so the review list shows LKR
          openReceiptReviewSheet(lines, function(res){
            draftMode = "itemized";
            // Drop blank placeholder rows so they don't block saving.
            draftItems = draftItems.filter(function(it){ return String(it.desc).trim() || Number(it.amount) > 0; });
            res.items.forEach(function(p){ draftItems.push(newDraftItem(p.desc, p.amount)); });
            res.extras.forEach(function(x){ draftExtras.push(newDraftExtra(x.desc, x.kind, "amount", x.amount, x.pct)); });
            draftReceiptTotal = res.receiptTotal;
            if(!draftDesc.trim()) draftDesc = lines.title || "Receipt";
            openBillSheet(existingSnapshot, true);
            toast(res.items.length+" item"+(res.items.length===1?"":"s")+" added — now tap who had each one");
          }, function(){
            draftCurrency = prevCurrency;   // Back: nothing about the bill changes
            openBillSheet(existingSnapshot, true);
          });
        }).catch(function(err){
          toast("Couldn't read that receipt: "+(err&&err.message?err.message:"try again"), true);
        }).finally(function(){
          receiptInput.value = "";
        });
      });

      if(readOnly){
        el.querySelectorAll("input, .chip, .btn").forEach(function(x){
          if(x.id === "b-close") return;
          x.style.pointerEvents = "none";
          if(x.tagName === "INPUT") x.readOnly = true;
          if(x.tagName === "BUTTON") x.style.display = "none";
        });
        el.querySelector("#b-close").addEventListener("click", closeSheet);
        return;
      }

      el.querySelector("#b-save").addEventListener("click", function(){
        var payload = {
          desc: el.querySelector("#b-desc").value.trim(),
          category: draftCat, paidBy: draftPaidBy,
          splitMode: draftMode,
          currency: draftCurrency, billDate: draftBillDate,
          fx: draftCurrency === "LKR" ? Object.assign({}, draftFx) : null
        };
        if(draftCurrency === "LKR" && !validRate(draftFx.rate)){
          toast(fxStatus === "loading" ? "Still getting the exchange rate — one sec" : "Set the exchange rate first", true); return;
        }
        lsSet("pw_last_cur", draftCurrency);
        if(draftCurrency === "LKR" && draftFx.source !== "manual") lsSet("pw_last_fxsrc", draftFx.source);
        if(draftMode==="itemized"){
          payload.items = draftItems.map(function(it){
            return { desc:it.desc, amount:it.amount, people:it.people.slice(), mode:it.mode, percents:Object.assign({},it.percents) };
          });
          payload.extras = resolvedExtras();
          payload.amount = grandTotal(); // for the quick checks below; validateBill recomputes it
        } else {
          payload.amount = parseFloat(el.querySelector("#b-amount").value);
          payload.split = draftSplit.slice();
          payload.splitAmounts = draftAmounts;
          payload.splitShares = draftShares;
        }
        if(!payload.desc){ toast("Add a short description", true); return; }
        if(!(payload.amount > 0)){ toast(draftMode==="itemized" ? "Add at least one item with an amount" : "Enter an amount", true); return; }
        try{
          if(existing) writeOp(updateBill(existing.id, payload), "Bill updated", this);
          else writeOp(addBill(payload), "Bill added", this);
        } catch(e){ toast(e.message, true); }
      });

      // Two-tap delete so a stray tap can't wipe a bill.
      var del = el.querySelector("#b-del"), delArmed = null;
      if(del) del.addEventListener("click", function(){
        if(!delArmed){
          del.textContent = "Tap again to delete";
          delArmed = setTimeout(function(){ delArmed = null; del.textContent = "Delete"; }, 3000);
          return;
        }
        clearTimeout(delArmed);
        writeOp(deleteBill(existing.id), "Bill deleted", this);
      });

      if(!existing) el.querySelector("#b-desc").focus();
    }
  );
}

/* ---- Day / itinerary edit sheet ---- */

function openDayEditSheet(day){
  var itemsHtml = day.items.map(function(it, i){
    return '<div class="split-row" data-idx="'+i+'">'+
      '<input type="text" class="split-input" data-role="item-time" data-idx="'+i+'" style="width:76px;" maxlength="20" value="'+esc(it[0])+'" placeholder="Time">'+
      '<input type="text" class="split-input" data-role="item-text" data-idx="'+i+'" style="flex:1;" maxlength="90" value="'+esc(it[1])+'" placeholder="What\'s happening">'+
      '<button class="btn btn-line btn-sm" data-role="item-del" data-idx="'+i+'" style="padding:6px 9px;">✕</button>'+
      '</div>';
  }).join("");

  openSheetHtml(
    '<h3>Edit Day '+day.day+'</h3>'+
    '<div class="field"><label>Title</label><input type="text" id="d-title" maxlength="60" value="'+esc(day.title)+'"></div>'+
    '<div class="field"><label>Staying in</label><input type="text" id="d-stay" maxlength="40" value="'+esc(day.stay)+'"></div>'+
    '<div class="field"><label>Schedule</label><div id="d-items">'+itemsHtml+'</div>'+
      '<button class="btn btn-ghost btn-sm" id="d-add-item" style="margin-top:4px;">+ Add item</button></div>'+
    '<div class="field"><label>Tip <span class="muted">(optional)</span></label>'+
      '<input type="text" id="d-tip" maxlength="140" value="'+esc(day.tip||"")+'"></div>'+
    '<div class="sheet-actions"><button class="btn btn-brand" id="d-save">Save day</button></div>',
    function(el){
      var items = day.items.map(function(it){ return it.slice(); });

      function renumber(){
        el.querySelectorAll('[data-role="item-del"]').forEach(function(btn, i){
          btn.dataset.idx = i;
        });
      }

      function addItemRow(time, text){
        var idx = items.length;
        items.push([time||"", text||""]);
        var row = document.createElement("div");
        row.className = "split-row";
        row.innerHTML =
          '<input type="text" class="split-input" data-role="item-time" style="width:76px;" maxlength="20" value="'+esc(time||"")+'" placeholder="Time">'+
          '<input type="text" class="split-input" data-role="item-text" style="flex:1;" maxlength="90" value="'+esc(text||"")+'" placeholder="What\'s happening">'+
          '<button class="btn btn-line btn-sm" data-role="item-del" style="padding:6px 9px;">✕</button>';
        el.querySelector("#d-items").appendChild(row);
        wireRow(row, idx);
      }

      function wireRow(row, idx){
        row.querySelector('[data-role="item-time"]').addEventListener("input", function(e){ items[idx][0] = e.target.value; });
        row.querySelector('[data-role="item-text"]').addEventListener("input", function(e){ items[idx][1] = e.target.value; });
        row.querySelector('[data-role="item-del"]').addEventListener("click", function(){
          items[idx] = null;
          row.remove();
        });
      }

      el.querySelectorAll("#d-items .split-row").forEach(function(row, idx){ wireRow(row, idx); });
      el.querySelector("#d-add-item").addEventListener("click", function(){ addItemRow("",""); });

      el.querySelector("#d-save").addEventListener("click", function(){
        var payload = {
          title: el.querySelector("#d-title").value.trim(),
          stay: el.querySelector("#d-stay").value.trim(),
          tip: el.querySelector("#d-tip").value.trim(),
          items: items.filter(function(it){ return it; })
        };
        if(!payload.title){ toast("Give this day a title", true); return; }
        try{
          writeOp(updateItinerary(day.day, payload), "Day "+day.day+" updated", this);
        } catch(e){ toast(e.message, true); }
      });
    }
  );
}

/* ====================== Delegated actions ====================== */

document.addEventListener("click", function(e){
  var t = e.target.closest("[data-action]");
  if(!t) return;
  var a = t.dataset.action;

  if(a==="toggle-day"){
    var d = parseInt(t.dataset.day,10);
    openDay = (openDay===d) ? 0 : d;
    render();
  }
  else if(a==="approve-req"){
    var who = t.dataset.id, nm = ((S.requests||[]).filter(function(x){ return x.email === who; })[0] || {}).name || who;
    writeOp(approveRequest(who), nm+" is in", t);
  }
  else if(a==="decline-req"){
    if(t.dataset.armed !== "1"){ t.dataset.armed = "1"; t.textContent = "Sure?"; setTimeout(function(){ t.dataset.armed = ""; t.textContent = "Decline"; }, 3000); return; }
    writeOp(declineRequest(t.dataset.id), "Request declined", t);
  }
  else if(a==="trip-settings"){
    openTripSettingsSheet();
  }
  else if(a==="goto-plan"){
    setTab("itinerary");
  }
  else if(a==="scan-bill"){
    openBillSheet(null, false, true);
  }
  else if(a==="edit-day"){
    var dayNum = parseInt(t.dataset.day,10);
    for(var di=0;di<S.itinerary.length;di++){
      if(S.itinerary[di].day===dayNum){ openDayEditSheet(S.itinerary[di]); break; }
    }
  }
  else if(a==="open-bill"){
    for(var i=0;i<S.bills.length;i++){
      if(S.bills[i].id===t.dataset.id){ openBillSheet(S.bills[i]); break; }
    }
  }
  else if(a==="mark-paid"){
    writeOp(
      addSettlement(t.dataset.from, t.dataset.to, parseFloat(t.dataset.amount)),
      pName(t.dataset.from)+" → "+pName(t.dataset.to)+" recorded", t);
  }
  else if(a==="undo-settle"){
    writeOp(deleteSettlement(t.dataset.id), "Payment removed", t);
  }
  else if(a==="copy-upi"){
    var upi = person(t.dataset.id).upi;
    function legacyCopy(){
      var ta = document.createElement("textarea");
      ta.value = upi; ta.setAttribute("readonly",""); ta.style.position="fixed"; ta.style.opacity="0";
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, upi.length);
      var ok = false; try{ ok = document.execCommand("copy"); }catch(err){}
      document.body.removeChild(ta);
      toast(ok ? "Copied "+upi : "UPI ID: "+upi+" (long-press to copy)");
    }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(upi).then(function(){ toast("Copied "+upi); }, legacyCopy);
    } else legacyCopy();
  }
});

/* ====================== Auth / Boot ====================== */

/* ---- Passkey (WebAuthn) local re-entry ----
   There's no backend here to mint Firebase custom tokens from a WebAuthn
   assertion, so this isn't a second independent identity provider — it's a
   device-local "fast unlock" for a Google session Firebase is already
   keeping signed in (Firebase Auth persists sessions in this browser by
   default). First sign-in is always Google. Right after that, we offer to
   register a passkey (Face ID / Touch ID / fingerprint / device PIN) tied to
   this browser profile. Next time the tab opens, if Firebase still has a
   persisted session AND a passkey is registered for that account, we ask for
   the biometric prompt before showing the app — so the phone/laptop is what's
   gating access, not just "the browser remembered me". If Firebase's session
   ever actually expires or is signed out, the person falls back to Google. */

var PASSKEY_KEY = "wk_passkey_v1"; // { email, credId (base64url) }

function passkeySupported(){
  return !!(window.PublicKeyCredential && navigator.credentials);
}
function getStoredPasskey(){
  try{ return JSON.parse(localStorage.getItem(PASSKEY_KEY) || "null"); }
  catch(e){ return null; }
}
function setStoredPasskey(v){
  try{
    if(v) localStorage.setItem(PASSKEY_KEY, JSON.stringify(v));
    else localStorage.removeItem(PASSKEY_KEY);
  } catch(e){}
}
function b64urlToBuf(s){
  s = s.replace(/-/g,"+").replace(/_/g,"/");
  while(s.length % 4) s += "=";
  var bin = atob(s), buf = new Uint8Array(bin.length);
  for(var i=0;i<bin.length;i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function bufToB64url(buf){
  var bytes = new Uint8Array(buf), bin = "";
  for(var i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function randomChallenge(){
  var a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return a;
}

function registerPasskey(email){
  if(!passkeySupported()) return Promise.reject(new Error("Face ID / Touch ID isn't available in this browser."));
  var userId = new TextEncoder().encode(email);
  return navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: { name: "Wicket Keepers" },
      user: { id: userId, name: email, displayName: pName(email) || email },
      pubKeyCredParams: [{ type:"public-key", alg:-7 }, { type:"public-key", alg:-257 }],
      authenticatorSelection: { authenticatorAttachment:"platform", userVerification:"required" },
      timeout: 60000
    }
  }).then(function(cred){
    setStoredPasskey({ email: email, credId: bufToB64url(cred.rawId) });
    return true;
  });
}

function unlockWithPasskey(saved){
  return navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge(),
      allowCredentials: [{ id: b64urlToBuf(saved.credId), type:"public-key" }],
      userVerification: "required",
      timeout: 60000
    }
  });
}

/* ---- Face ID lock state ----
   "Unlocked" lasts for this app session (sessionStorage): closing the app or
   tab locks it again. A fresh Google sign-in counts as unlocking. */
function lsGet(k){ k = "wk:" + k; try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k,v){ k = "wk:" + k; try{ if(v==null) localStorage.removeItem(k); else localStorage.setItem(k,v); }catch(e){} }
function ssGet(k){ k = "wk:" + k; try{ return sessionStorage.getItem(k); }catch(e){ return null; } }
function ssSet(k,v){ k = "wk:" + k; try{ if(v==null) sessionStorage.removeItem(k); else sessionStorage.setItem(k,v); }catch(e){} }

function passkeyFor(email){
  var saved = getStoredPasskey();
  return (saved && saved.email === email && passkeySupported()) ? saved : null;
}
function isUnlocked(email){ return ssGet("pw_unlocked") === email; }
function markUnlocked(email){ ssSet("pw_unlocked", email); }

function offerPasskeySetup(email){
  if(!passkeySupported()) return;
  if(passkeyFor(email)) return;                          // already set up here
  if(lsGet("pw_passkey_dismissed") === email) return;    // said "Not now" before
  openSheetHtml(
    '<h3>Lock with Face ID?</h3>'+
    '<p class="muted" style="font-size:13.5px;line-height:1.5;">Next time you open Wicket Keepers on this device, you\'ll unlock it with Face ID / Touch ID / fingerprint instead of it just opening. You can turn this off any time from Edit.</p>'+
    '<div class="sheet-actions">'+
      '<button class="btn btn-ghost" id="pk-skip">Not now</button>'+
      '<button class="btn btn-brand" id="pk-go">Turn on</button>'+
    '</div>',
    function(el){
      el.querySelector("#pk-skip").addEventListener("click", function(){
        lsSet("pw_passkey_dismissed", email);
        closeSheet();
      });
      el.querySelector("#pk-go").addEventListener("click", function(){
        var btn = this; btn.disabled = true;
        registerPasskey(email).then(function(){
          markUnlocked(email);
          closeSheet();
          toast("Face ID lock is on for this device");
        }).catch(function(err){
          btn.disabled = false;
          toast(err && err.name==="NotAllowedError" ? "Cancelled" : (err && err.message ? err.message : "Couldn't set that up"), true);
        });
      });
    }
  );
}

/** The boot/sign-in container lives inside #app, which buildShell() replaces
    once the app loads. Recreate it when needed (e.g. after signing out). */
function bootEl(){
  var b = document.getElementById("boot");
  if(!b){
    document.getElementById("app").innerHTML = '<div class="boot" id="boot"></div>';
    b = document.getElementById("boot");
  }
  return b;
}

function showBootLoading(){
  bootEl().innerHTML =
    '<img class="logo" src="icon-192.png" alt="Wicket Keepers"><h2>Wicket Keepers</h2>'+
    '<p id="boot-msg">Loading the trip…</p>'+
    '<div class="spinner" id="boot-spinner"></div>'+
    '<div id="boot-extra"></div>';
}

function doGoogleSignIn(){
  ssSet("pw_google_pending", "1");
  var provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  auth.signInWithPopup(provider).catch(function(err){
    ssSet("pw_google_pending", null);
    if(err && (err.code==="auth/popup-closed-by-user" || err.code==="auth/cancelled-popup-request")) return;
    toast(err && err.message ? err.message : "Sign-in failed", true);
  });
}

function showSignIn(){
  bootEl().innerHTML =
    '<img class="logo" src="icon-192.png" alt="Wicket Keepers">'+
    '<h2>Wicket Keepers</h2>'+
    '<p>Sign in with Google to see the itinerary and shared bills.</p>'+
    '<button class="google-btn" id="google-signin" style="margin-top:18px;max-width:280px;">'+
      '<img src="https://www.gstatic.com/images/branding/product/1x/gsa_512dp.png" alt="">'+
      'Sign in with Google</button>';
  document.getElementById("google-signin").addEventListener("click", doGoogleSignIn);
}

function showLockScreen(user, saved){
  var email = normEmail(user.email);
  bootEl().innerHTML =
    '<div class="logo-lock"><img class="logo" src="icon-192.png" alt="Wicket Keepers"><span>🔒</span></div>'+
    '<h2>Wicket Keepers</h2>'+
    '<p>Welcome back'+(user.displayName ? ', '+esc(String(user.displayName).split(" ")[0]) : '')+'.</p>'+
    '<button class="btn btn-brand btn-wide" id="faceid-unlock" style="margin-top:18px;max-width:280px;">Unlock with Face ID</button>'+
    '<button class="btn btn-ghost btn-wide" id="lock-google" style="margin-top:10px;max-width:280px;">Use Google instead</button>';
  var fBtn = document.getElementById("faceid-unlock");
  function tryUnlock(){
    fBtn.disabled = true;
    unlockWithPasskey(saved).then(function(){
      markUnlocked(email);
      proceedBoot();
    }).catch(function(err){
      fBtn.disabled = false;
      if(err && err.name === "NotAllowedError") return; // cancelled / timed out
      toast(err && err.message ? err.message : "Couldn't unlock", true);
    });
  }
  fBtn.addEventListener("click", tryUnlock);
  document.getElementById("lock-google").addEventListener("click", function(){
    auth.signOut();   // → sign-in screen; a fresh Google sign-in unlocks this session
  });
}

var passkeyOffered = false;
var nowTimer = null;

function proceedBoot(){
  showBootLoading();
  startListeners();
}

function teardown(){
  booted = false;
  joinShown = false;
  passkeyOffered = false;
  if(unsubPeople) unsubPeople();
  if(unsubBills) unsubBills();
  if(unsubSettlements) unsubSettlements();
  if(unsubItinerary) unsubItinerary();
  if(unsubTrip) unsubTrip();
  unsubPeople = unsubBills = unsubSettlements = unsubItinerary = unsubTrip = null;
  latestSnapshots = { people:null, bills:null, settlements:null, itinerary:null, trip:null };
  stopRequestsListener();
  stopJoinWatch();
  adminsCreating = false;
  itinerarySeeded = false;
  if(nowTimer){ clearInterval(nowTimer); nowTimer = null; }
  closeSheet();
}

auth.onAuthStateChanged(function(user){
  teardown();
  if(!user){
    ssSet("pw_unlocked", null);
    showSignIn();
    return;
  }
  S.me = normEmail(user.email);
  S.myPhoto = user.photoURL || "";

  if(ssGet("pw_google_pending")){
    ssSet("pw_google_pending", null);
    markUnlocked(S.me);
  }

  var saved = passkeyFor(S.me);
  if(saved && !isUnlocked(S.me)){
    showLockScreen(user, saved);
    return;
  }
  proceedBoot();
});
