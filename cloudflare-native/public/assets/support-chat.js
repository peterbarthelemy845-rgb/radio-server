(()=>{
 'use strict';
 const support=document.getElementById('support'),ticketForm=document.getElementById('ticketForm');
 if(!support||!ticketForm||document.getElementById('supportChat'))return;
 const copy={
  en:{title:'Ask the help assistant',intro:'AI selects steps from our approved guides. Your question is sent for AI processing. Do not send passwords or private codes.',question:'What do you need help with?',placeholder:'Example: My radio has no sound',send:'Ask',sending:'Checking the guides…',contact:'Contact support',guide:'Approved guide',guides:'Read help guides',guidesLoading:'Loading help guides…',guidesUnavailable:'Help guides could not load. Contact support for help.',clear:'Clear chat',empty:'Enter a question first.',long:'Keep your question under 1,000 characters.',busy:'Please wait for the current answer.',limited:'Too many questions. Try the help guides or contact support.',unavailable:'The assistant could not answer. Use the help guides or contact support.',security:'The security check did not complete. Try again or contact support.',privacy:'Chat stays in this tab and is not added to your support ticket.',you:'You',assistant:'Help assistant',ticket:'My ticket',ticketUnavailable:'Ticket status is unavailable. Please reload this page and try again.',report:'Report this station',reportUnavailable:'The current station is unavailable. Check radio status or contact support.',wifi:'Wi-Fi',sound:'No sound',freezing:'Radio freezing'},
  ht:{title:'Poze asistan èd la yon kesyon',intro:'AI chwazi etap nan gid apwouve nou yo. Nou voye kesyon ou pou AI trete li. Pa voye modpas oswa kòd prive.',question:'Pou ki sa ou bezwen èd?',placeholder:'Egzanp: Radyo mwen pa gen son',send:'Mande',sending:'N ap tcheke gid yo…',contact:'Kontakte sipò',guide:'Gid apwouve',guides:'Li gid èd yo',guidesLoading:'N ap chaje gid èd yo…',guidesUnavailable:'Gid èd yo pa t ka chaje. Kontakte sipò pou jwenn èd.',clear:'Efase konvèsasyon an',empty:'Antre yon kesyon anvan.',long:'Kesyon ou dwe gen mwens pase 1,000 karaktè.',busy:'Tanpri tann repons aktyèl la.',limited:'Twòp kesyon. Eseye gid yo oswa kontakte sipò.',unavailable:'Asistan an pa t ka reponn. Sèvi ak gid yo oswa kontakte sipò.',security:'Verifikasyon sekirite a pa fini. Eseye ankò oswa kontakte sipò.',privacy:'Konvèsasyon an rete nan tab sa a. Li pa ajoute nan demann sipò ou.',you:'Ou',assistant:'Asistan èd',ticket:'Demann mwen',ticketUnavailable:'Estati demann lan pa disponib. Tanpri rechaje paj la epi eseye ankò.',report:'Rapòte estasyon sa a',reportUnavailable:'Estasyon kounye a pa disponib. Tcheke estati radyo a oswa kontakte sipò.',wifi:'Wi-Fi',sound:'Pa gen son',freezing:'Radyo a bloke'}
 };
 const language=()=>window.appI18n?.language==='ht'?'ht':'en',t=key=>{const value=window.appI18n?.t('supportChat.'+key);return value&&value!=='supportChat.'+key?value:copy[language()][key];};
 const labels=[];
 function node(tag,className,text){const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;}
 function labelled(tag,key,className){const element=node(tag,className);labels.push([element,key]);return element;}
 function button(key,className='secondary'){const element=labelled('button',key,className);element.type='button';return element;}
 const card=node('section','support-chat-card');card.id='supportChat';card.dataset.i18nSkip='1';
 const toggle=button('title','support-chat-toggle');toggle.id='supportChatToggle';toggle.setAttribute('aria-expanded','true');toggle.setAttribute('aria-controls','supportChatPanel');
 const panel=node('div','support-chat-panel');panel.id='supportChatPanel';panel.hidden=false;
 const disclosure=labelled('p','intro','support-chat-disclosure'),privacy=labelled('p','privacy','support-chat-disclosure');
 const thread=node('div','support-chat-thread');thread.id='supportChatThread';thread.setAttribute('role','log');thread.setAttribute('aria-live','polite');thread.setAttribute('aria-relevant','additions');
 const form=node('form','support-chat-form');form.id='supportChatForm';
 const label=labelled('label','question'),input=node('textarea');input.id='supportChatQuestion';input.name='question';input.maxLength=1000;input.rows=2;input.required=true;input.autocomplete='off';input.setAttribute('aria-describedby','supportChatDisclosure supportChatCount');label.htmlFor=input.id;disclosure.id='supportChatDisclosure';
 const count=node('span','support-chat-count','0 / 1,000');count.id='supportChatCount';
 const security=node('div','human'),submit=labelled('button','send','support-chat-send');submit.type='submit';
 const status=node('p','support-chat-status');status.id='supportChatStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const suggestions=node('div','support-chat-suggestions');
 for(const key of ['wifi','ticket','sound','freezing']){const choice=button(key,'support-chat-suggestion');
  if(key==='ticket'){choice.id='supportChatTicket';choice.setAttribute('aria-haspopup','dialog');choice.setAttribute('aria-controls','supportTicketsDialog');choice.onclick=()=>{if(pending)return;if(typeof window.supportTickets?.open==='function')window.supportTickets.open();else feedback('ticketUnavailable');};}
  else choice.onclick=()=>{if(pending)return;topic=key;input.value=t(key);updateCount();renderReport();input.focus({preventScroll:true});};suggestions.append(choice);
 }
 const contact=button('contact','support-chat-contact'),clear=button('clear','support-chat-clear'),report=button('report','support-chat-contact');report.id='supportChatReportStation';report.hidden=true;report.setAttribute('aria-controls','ticketForm');
 const helpGuides=node('details','support-chat-source support-chat-guides');helpGuides.id='supportChatGuides';helpGuides.hidden=true;const helpSummary=labelled('summary','guides'),helpStatus=node('p','support-chat-status'),helpList=node('div','support-chat-thread support-chat-guide-list');helpStatus.setAttribute('role','status');helpGuides.append(helpSummary,helpStatus,helpList);
 const actions=node('div','support-chat-actions');actions.append(contact,clear,report);form.append(label,input,count,suggestions,security,submit,status);panel.append(disclosure,thread,form,helpGuides,actions,privacy);card.append(toggle,panel);
 const anchor=document.getElementById('supportGuidedFlow')||ticketForm;anchor.before(card);
 let pending=false,controller=null,history=[],generation=0,statusKey='',topic='',guideGeneration=0,guideRequest=null,guideStatusKey='';const guideCache=new Map();
 const topicSubjects={wifi:'Wi-Fi connection problem',sound:'No sound or playback problem',freezing:'Device keeps freezing',account:'Station login or email code problem'};
 function currentStationCode(){try{const code=window.currentStationTileCode?.();return /^[1-9][0-9]{1,5}$/.test(String(code||''))?String(code):null;}catch{return null;}}
 function renderReport(){report.hidden=topic!=='sound'||!currentStationCode()||typeof window.openStationProblemReport!=='function';}
 function updateCount(){count.textContent=input.value.length+' / 1,000';}
 function renderLabels(){for(const [element,key] of labels)element.textContent=t(key);input.placeholder=t('placeholder');submit.textContent=t(pending?'sending':'send');if(statusKey)status.textContent=t(statusKey);renderReport();}
 function feedback(key){statusKey=key;status.textContent=key?t(key):'';if(['limited','unavailable','security'].includes(key))helpGuides.hidden=false;}
 function setBusy(value){pending=value;input.disabled=value;submit.disabled=value;clear.disabled=value;for(const choice of suggestions.children)choice.disabled=value;form.setAttribute('aria-busy',String(value));renderLabels();}
 function message(role,text,lang){const bubble=node('article','support-chat-message support-chat-message-'+role),who=node('strong','support-chat-who',copy[lang][role==='user'?'you':'assistant']),body=node('p',null,text);bubble.dataset.i18nSkip='1';bubble.lang=lang;bubble.append(who,body);thread.append(bubble);while(thread.children.length>6)thread.children[0].remove();return bubble;}
 function validResult(result){return result&&typeof result.answer==='string'&&result.answer.length>0&&result.answer.length<=700&&Array.isArray(result.sources)&&result.sources.length<=1&&result.sources.every(source=>source&&/^[a-z][a-z0-9-]{1,39}$/.test(source.id)&&typeof source.title==='string'&&source.title.length<=120&&Array.isArray(source.steps)&&source.steps.length<=6&&source.steps.every(step=>typeof step==='string'&&step.length>0&&step.length<=400));}
 function addSources(bubble,sources,lang){for(const source of sources){const details=node('details','support-chat-source'),summary=node('summary',null,copy[lang].guide+': '+source.title),steps=node('ol');for(const text of source.steps)steps.append(node('li',null,text));details.append(summary,steps);bubble.append(details);}}
 function renderHelpGuides(guides,lang){helpList.replaceChildren();helpList.lang=lang;for(const guide of guides){const details=node('details','support-chat-source'),summary=node('summary',null,guide.title),steps=node('ol');for(const step of guide.steps)steps.append(node('li',null,step));details.append(summary,steps);helpList.append(details);}guideStatusKey='';helpStatus.textContent='';}
 async function loadHelpGuides(){
  const lang=language(),transport=window.supportChatTransport;if(guideCache.has(lang)){renderHelpGuides(guideCache.get(lang),lang);return;}if(guideRequest?.language===lang)return;
  guideRequest?.controller.abort();const current=++guideGeneration,abort=new AbortController();guideRequest={controller:abort,language:lang};helpList.replaceChildren();guideStatusKey='guidesLoading';helpStatus.textContent=t(guideStatusKey);
  try{if(typeof transport?.api!=='function')throw Error('Help transport unavailable');const result=await transport.api('/api/support/guides?language='+lang,undefined,{signal:abort.signal});if(current!==guideGeneration||lang!==language())return;
   if(!Array.isArray(result?.guides)||!result.guides.length||result.guides.length>12||!result.guides.every(guide=>guide&&/^[a-z][a-z0-9-]{1,39}$/.test(guide.id)&&typeof guide.title==='string'&&guide.title.length<=120&&Array.isArray(guide.steps)&&guide.steps.length>0&&guide.steps.length<=8&&guide.steps.every(step=>typeof step==='string'&&step.length>0&&step.length<=400)))throw Error('Invalid help guides');
   guideCache.set(lang,result.guides);renderHelpGuides(result.guides,lang);
  }catch(error){if(current===guideGeneration&&error?.name!=='AbortError'){guideStatusKey='guidesUnavailable';helpStatus.textContent=t(guideStatusKey);}}
  finally{if(current===guideGeneration)guideRequest=null;}
 }
 helpGuides.addEventListener('toggle',()=>{if(helpGuides.open&&!helpGuides.hidden)void loadHelpGuides();});
 toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)input.focus({preventScroll:true});};
 contact.onclick=()=>{
  if(pending){generation++;controller?.abort();setBusy(false);}
  const subject=topicSubjects[topic];if(typeof window.supportGuidedFlow?.openContact==='function')window.supportGuidedFlow.openContact({subject});
  else{if(subject&&ticketForm.elements?.subject&&!ticketForm.elements.subject.value)ticketForm.elements.subject.value=subject;ticketForm.hidden=false;(ticketForm.elements?.name||ticketForm.querySelector('input'))?.focus({preventScroll:true});ticketForm.scrollIntoView?.({block:'start',behavior:'auto'});}
 };
 report.onclick=()=>{
  const code=currentStationCode();if(topic!=='sound'||!code||typeof window.openStationProblemReport!=='function'){renderReport();feedback('reportUnavailable');return;}
  if(window.openStationProblemReport({code})!==true){feedback('reportUnavailable');return;}
  if(pending){generation++;controller?.abort();setBusy(false);}
  window.supportGuidedFlow?.openContact?.({subject:'Station problem',focus:false});
 };
 clear.onclick=()=>{if(pending)return;history=[];topic='';thread.replaceChildren();feedback('');helpGuides.hidden=true;helpGuides.open=false;input.value='';updateCount();renderReport();input.focus({preventScroll:true});};
 input.addEventListener('input',()=>{updateCount();feedback('');});
 form.onsubmit=async event=>{
  event.preventDefault();if(pending)return;
  const question=input.value.trim(),lang=language(),transport=window.supportChatTransport;
  if(!question){feedback('empty');input.focus();return;}if(question.length>1000){feedback('long');input.focus();return;}
  if(typeof transport?.human!=='function'||typeof transport?.api!=='function'){feedback('unavailable');return;}
  const current=++generation;controller=new AbortController();setBusy(true);feedback('');let verified=false;
  try{
   const turnstile_token=await transport.human(form,'support_chat',controller.signal);if(current!==generation)return;verified=true;
   const result=await transport.api('/api/support/chat',{question,language:lang,conversation:history.slice(-4),turnstile_token},{signal:controller.signal});if(current!==generation)return;
   if(!validResult(result))throw Error('Invalid assistant response.');
   const guide=result.sources[0]?.id;if(guide==='wifi-connect')topic='wifi';else if(guide==='no-sound')topic='sound';else if(guide==='radio-freezing')topic='freezing';else if(['station-signin','station-logo','station-stream'].includes(guide))topic='account';renderReport();helpGuides.hidden=!result.needs_support;
   message('user',question,lang);const answer=message('assistant',result.answer,lang);addSources(answer,result.sources,lang);
   history=[...history,{role:'user',content:question},{role:'assistant',content:result.answer}].slice(-4);input.value='';updateCount();
   if(!support.hidden&&!document.hidden)answer.scrollIntoView?.({block:'nearest',behavior:'auto'});
  }catch(error){if(current!==generation||error?.name==='AbortError')return;feedback(error?.status===429?'limited':verified?'unavailable':'security');}
  finally{if(current===generation){controller=null;setBusy(false);}}
 };
 window.addEventListener('app-language-changed',()=>{renderLabels();if(guideStatusKey)helpStatus.textContent=t(guideStatusKey);if(helpGuides.open&&!helpGuides.hidden)void loadHelpGuides();});
 for(const event of ['radio-status-updated','radio-selection-changed','radio-current-station-invalidated'])window.addEventListener(event,renderReport);
 window.addEventListener('pagehide',()=>{generation++;controller?.abort();controller=null;guideGeneration++;guideRequest?.controller.abort();guideRequest=null;setBusy(false);});
 renderLabels();
})();
