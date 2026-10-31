"use strict";
(()=>{
 const login=document.getElementById('ownerLoginPanel'),registration=document.getElementById('ownerRegistrationPanel');
 if(!login||!registration)return;
 const create=document.getElementById('ownerCreateStation'),back=document.getElementById('ownerBackToLogin');
 function selectRegistration(show){
  login.hidden=show;registration.hidden=!show;
  const field=show?registration.querySelector('input[name="name"]'):document.getElementById('stationAccessEmail');
  field?.focus();
 }
 create?.addEventListener('click',event=>{event.preventDefault();selectRegistration(true);});
 back?.addEventListener('click',()=>selectRegistration(false));
})();
