document.addEventListener('DOMContentLoaded', () => {
  const token = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const status = (el, msg, ok = false) => { el.textContent = msg; el.dataset.state = ok ? 'success' : 'error'; };
  const account = document.querySelector('#account-form'), accountStatus = document.querySelector('#account-status');
  account?.addEventListener('submit', async e => {
    e.preventDefault(); const button = account.querySelector('[type=submit]'); button.disabled = true; status(accountStatus, 'Saving…');
    try { const response = await fetch('/profile/account', {method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify({name:account.elements.name.value})}); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not save changes.');
      account.elements.name.value = data.user.name; document.querySelector('.profile-identity h2').textContent = data.user.name;
      const initials = data.user.name.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase(); document.querySelector('.profile-avatar').textContent = initials || '?';
      document.querySelectorAll('.header-identity h1,.header-identity .identity-name').forEach(n=>n.textContent=data.user.name);
      status(accountStatus, 'Changes saved.', true);
    } catch(error) { status(accountStatus, error.message); } finally { button.disabled = false; }
  });
  const dialog = document.querySelector('#password-dialog'), opener = document.querySelector('#open-password'), form = document.querySelector('#password-form'), passwordStatus = document.querySelector('#password-status');
  const close = () => { dialog.close(); form.reset(); passwordStatus.textContent=''; opener.focus(); };
  opener.addEventListener('click',()=>dialog.showModal()); document.querySelector('#close-password').addEventListener('click',close); document.querySelector('#cancel-password').addEventListener('click',close);
  dialog.addEventListener('close',()=>{form.reset(); passwordStatus.textContent=''; opener.focus();});
  form.addEventListener('submit', async e=>{ e.preventDefault(); const button=form.querySelector('[type=submit]');
    if(form.elements.newPassword.value!==form.elements.confirmPassword.value){status(passwordStatus,'New passwords do not match.');form.elements.confirmPassword.focus();return;}
    button.disabled=true;status(passwordStatus,'Updating…');
    try{const response=await fetch('/profile/password',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify({currentPassword:form.elements.currentPassword.value,newPassword:form.elements.newPassword.value,confirmPassword:form.elements.confirmPassword.value})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not update password.');status(passwordStatus,'Password updated.',true);form.reset();setTimeout(()=>{if(dialog.open)close();},700);}catch(error){status(passwordStatus,error.message);}finally{button.disabled=false;}
  });
  document.querySelectorAll('[data-export]').forEach(button=>button.addEventListener('click',async()=>{const kind=button.dataset.export;button.disabled=true;const label=button.textContent;button.textContent='Preparing…';status(document.querySelector('#export-status'),'Preparing download…',true);
    try{const response=await fetch(`/profile/export/${kind}`);if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'Export could not be prepared.');}const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(response.headers.get('Content-Disposition')?.match(/filename="([^"]+)/)||[])[1]||`habitcents-${kind}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);const warning=response.headers.get('X-Export-Warnings');status(document.querySelector('#export-status'),warning?`Download started. Some optional data is unavailable: ${decodeURIComponent(warning)}`:'Download started.',!warning);
    }catch(error){status(document.querySelector('#export-status'),error.message);}finally{button.disabled=false;button.textContent=label;}
  }));
});
