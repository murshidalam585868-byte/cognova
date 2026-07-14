javascript:(function(){
  // GoDaddy DNS Auto-Fill Bookmarklet for Cognova
  // Usage: Click this bookmark when on GoDaddy DNS Management page
  
  function waitForElement(selector, timeout=5000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); reject('timeout'); }, timeout);
    });
  }
  
  async function fillARecord() {
    // Click Add New Record
    const addBtn = [...document.querySelectorAll('button')].find(b => b.innerText?.trim() === 'Add New Record');
    if (!addBtn) { alert('Add New Record button not found! Make sure you are on the DNS Records tab.'); return; }
    addBtn.click();
    await new Promise(r => setTimeout(r, 800));
    
    // Set Type to A
    const typeSelect = document.getElementById('dnsRecordIdDropdown');
    if (typeSelect) { typeSelect.value = 'a'; typeSelect.dispatchEvent(new Event('change', {bubbles: true})); }
    await new Promise(r => setTimeout(r, 300));
    
    // Set Name to brain
    const nameInput = document.getElementById('nameDnsFieldInput');
    if (nameInput) { nameInput.value = 'brain'; nameInput.dispatchEvent(new Event('input', {bubbles: true})); }
    
    // Set Value to 76.76.21.21
    const valInput = document.querySelector('input[type="text"]:not([id="nameDnsFieldInput"])');
    if (valInput) { valInput.value = '76.76.21.21'; valInput.dispatchEvent(new Event('input', {bubbles: true})); }
    
    // Set TTL to 1800 (1 Hour)
    const ttlSelect = document.getElementById('ttl');
    if (ttlSelect) { ttlSelect.value = '1800'; ttlSelect.dispatchEvent(new Event('change', {bubbles: true})); }
    
    alert('✅ A Record filled!\n\nType: A\nName: brain\nValue: 76.76.21.21\nTTL: 1 Hour\n\nNow click the Save button manually.');
  }
  
  async function fillCNAME() {
    const addBtn = [...document.querySelectorAll('button')].find(b => b.innerText?.trim() === 'Add New Record');
    if (!addBtn) { alert('Add New Record button not found!'); return; }
    addBtn.click();
    await new Promise(r => setTimeout(r, 800));
    
    const typeSelect = document.getElementById('dnsRecordIdDropdown');
    if (typeSelect) { typeSelect.value = 'cname'; typeSelect.dispatchEvent(new Event('change', {bubbles: true})); }
    await new Promise(r => setTimeout(r, 300));
    
    const nameInput = document.getElementById('nameDnsFieldInput');
    if (nameInput) { nameInput.value = 'www.brain'; nameInput.dispatchEvent(new Event('input', {bubbles: true})); }
    
    const valInput = document.querySelector('input[type="text"]:not([id="nameDnsFieldInput"])');
    if (valInput) { valInput.value = 'cname.vercel-dns.com'; valInput.dispatchEvent(new Event('input', {bubbles: true})); }
    
    const ttlSelect = document.getElementById('ttl');
    if (ttlSelect) { ttlSelect.value = '3600'; ttlSelect.dispatchEvent(new Event('change', {bubbles: true})); }
    
    alert('✅ CNAME Record filled!\n\nType: CNAME\nName: www.brain\nValue: cname.vercel-dns.com\nTTL: 1 Hour\n\nNow click the Save button manually.');
  }
  
  // Ask user which record to fill
  const choice = prompt('Cognova DNS Auto-Fill\n\nWhich record to fill?\n1 = A Record (brain → 76.76.21.21)\n2 = CNAME Record (www.brain → cname.vercel-dns.com)\n\nEnter 1 or 2:');
  if (choice === '1') fillARecord();
  else if (choice === '2') fillCNAME();
  else alert('Cancelled. Enter 1 or 2 next time.');
})();
