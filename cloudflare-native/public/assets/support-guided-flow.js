(()=>{
 'use strict';
 const support=document.getElementById('support'),form=document.getElementById('ticketForm'),videos=document.getElementById('supportVideos'),tickets=document.getElementById('supportTicketStatus');
 if(!support||!form||!videos||!tickets||!form.elements?.subject)return;
 const topics={
  wifi:{key:'supportFlow.wifi',label:'Wi-Fi',subject:'Wi-Fi connection problem',steps:[['wifi1','On your radio, open Settings → Wi-Fi.'],['wifi2','Choose your 2.4 GHz network and enter its password.'],['wifi3','Keep the radio near your router while it connects.']],match:/wi[\s-]?fi|wireless/i},
  sound:{key:'supportFlow.sound',label:'No sound',subject:'No sound or playback problem',steps:[['sound1','Turn up the volume on your radio.'],['sound2','Try another station. If only one fails, report that station.']],match:/sound|audio|volume|playback/i},
  freezing:{key:'supportFlow.freezing',label:'Radio freezing',subject:'Device keeps freezing',steps:[['freezing1','Turn the radio off, wait 10 seconds, then turn it on again.'],['freezing2','If it keeps freezing, contact support below.']],match:/freez|unresponsive|restart/i},
  account:{key:'supportFlow.account',label:'Station account',subject:'Station login or email code problem',steps:[['account1','Sign in with your registered email and Station code.'],['account2','Enter the private email code to edit your station.']],match:/station[\s-]*(?:account|owner|logo)|sign[\s-]?in|registered|stream (?:url|setup)/i}
 };
 function text(key,fallback){const value=window.appI18n?.t(key);return value&&value!==key?value:fallback;}
 function node(tag,key,fallback,className){const element=document.createElement(tag);if(key){element.dataset.i18n=key;element.textContent=text(key,fallback);}if(className)element.className=className;return element;}
 function button(key,fallback,className='secondary'){const element=node('button',key,fallback,className);element.type='button';return element;}
 const host=node('section',null,null,'support-guided-flow');host.id='supportGuidedFlow';
 const questions=node('div'),heading=node('h2','supportFlow.title','What’s wrong?');heading.id='supportFlowTitle';heading.tabIndex=-1;
 const choices=node('div',null,null,'support-topic-choices');choices.setAttribute('role','group');choices.setAttribute('aria-labelledby',heading.id);
 const topicButtons=new Map();for(const [id,topic] of Object.entries(topics)){const choice=button(topic.key,topic.label,'support-topic-choice');choice.dataset.supportTopic=id;choice.setAttribute('aria-controls','supportTopicHelp');choice.onclick=()=>chooseTopic(id);topicButtons.set(id,choice);choices.append(choice);}
 const otherContact=button('supportFlow.contact','Contact support','support-contact-link');otherContact.setAttribute('aria-controls','ticketForm');otherContact.onclick=()=>openContact();questions.append(heading,choices,otherContact);
 const help=node('section',null,null,'support-topic-help');help.id='supportTopicHelp';help.hidden=true;
 const chooseAgain=button('supportFlow.chooseAgain','Choose another problem','support-help-back');chooseAgain.onclick=()=>{if(pending())return;topicId='';contact=false;videos.scrollLeft=0;render();heading.focus({preventScroll:true});};
 const helpTitle=node('h2');helpTitle.id='supportTopicTitle';helpTitle.tabIndex=-1;help.setAttribute('aria-labelledby',helpTitle.id);const steps=node('ol');help.append(chooseAgain,helpTitle,steps);
 const helpContact=button('supportFlow.contact','Contact support','support-contact-primary');helpContact.setAttribute('aria-controls','ticketForm');helpContact.onclick=()=>openContact({subject:topics[topicId]?.subject});
 const contactBack=button('supportFlow.back','Back to help','support-help-back');contactBack.hidden=true;contactBack.onclick=()=>{if(pending())return;contact=false;render();(topicId?helpTitle:document.getElementById('supportChatToggle'))?.focus({preventScroll:true});};
 const formHeading=form.querySelector('h2');if(formHeading){formHeading.dataset.i18n='supportFlow.contactTitle';formHeading.textContent=text('supportFlow.contactTitle','Contact support');}
 const subjectField=form.elements.subject,subjectLabel=subjectField.closest?.('label')||(subjectField.parentElement?.tagName==='LABEL'?subjectField.parentElement:null),subjectSummary=node('div',null,null,'support-subject-summary');subjectSummary.id='supportSubjectSummary';subjectSummary.dataset.i18nSkip='1';subjectSummary.hidden=true;
 const subjectValue=node('span'),subjectChange=button('supportFlow.changeSubject','Change','link support-subject-change');subjectChange.id='supportSubjectChange';subjectChange.setAttribute('aria-controls',subjectField.id||'supportSubject');if(!subjectField.id)subjectField.id='supportSubject';subjectSummary.append(subjectValue,subjectChange);(subjectLabel||subjectField).before(subjectSummary);
 // Keep existing tutorial nodes: no new media source or external request is
 // introduced. Ticket lookup stays available below either help or the form.
 videos.before(host);host.append(contactBack,questions,help,videos,helpContact);form.after(tickets);
 let topicId='',contact=!!form.dataset.dirty||!!form.elements.station_code?.value,autoSubject='',subjectEditing=false;
 const pausedFrames=new WeakMap(),guideDescriptions=new WeakMap();
 function pending(){return form.dataset.busy==='1'||form.getAttribute('aria-busy')==='true';}
 function pauseCard(card){
  for(const video of card.querySelectorAll('video'))video.pause();
  for(const frame of card.querySelectorAll('iframe'))if(/^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}$/.test(frame.src)){pausedFrames.set(frame,frame.src);frame.src='about:blank';}
 }
 function restoreCard(card){for(const frame of card.querySelectorAll('iframe')){const source=pausedFrames.get(frame);if(source){pausedFrames.delete(frame);frame.src=source;}}}
 function describeGuide(card){
  if(!guideDescriptions.has(card))guideDescriptions.set(card,{source:card.querySelector('video source')?.getAttribute('src')||card.querySelector('video source')?.src||'',title:card.querySelector('h3')?.textContent||''});
  return guideDescriptions.get(card);
 }
 function relevant(card,topic){
  const {source,title}=describeGuide(card);
  // Resetting a Device Code is not a fix for freezing or account sign-in.
  if(/\/assets\/help-(?:wifi|station|reset)\.mp4$/.test(source))return topic===topics.wifi&&/\/assets\/help-wifi\.mp4$/.test(source);
  return topic.match.test(title);
 }
 function renderGuides(){
  const selected=topics[topicId],visible=!!selected&&!contact&&!support.hidden&&!document.hidden;let count=0;
  // Classify the approved original title before translation can replace it.
  for(const card of videos.children){describeGuide(card);const show=visible&&relevant(card,selected);card.hidden=!show;if(show){count++;restoreCard(card);}else pauseCard(card);}
  videos.hidden=!count;window.dispatchEvent(new Event('support-guided-flow-updated'));
 }
 function render(){
  host.dataset.view=contact?'contact':topicId?'topic':'choose';questions.hidden=true;help.hidden=contact||!topicId;helpContact.hidden=contact||!topicId;contactBack.hidden=!contact;form.hidden=!contact;
  const disabled=pending();contactBack.disabled=disabled;chooseAgain.disabled=disabled;otherContact.disabled=disabled;helpContact.disabled=disabled;for(const choice of topicButtons.values())choice.disabled=disabled;
  renderSubject();
  renderGuides();
 }
 function renderSubject(){
  const chosen=!!subjectField.value&&!subjectEditing,lang=window.appI18n?.language==='ht'?'ht':'en',labels={'Wi-Fi connection problem':'Pwoblèm koneksyon Wi-Fi','No sound or playback problem':'Pa gen son oswa pwoblèm lekti','Device keeps freezing':'Aparèy la kontinye bloke','Station login or email code problem':'Pwoblèm koneksyon kont oswa kòd imèl','Station problem':'Pwoblèm estasyon'};
  subjectSummary.hidden=!contact||!chosen;(subjectLabel||subjectField).hidden=chosen;subjectChange.disabled=pending();subjectValue.textContent=(lang==='ht'?'Sijè: ':'Subject: ')+(lang==='ht'?(labels[subjectField.value]||subjectField.selectedOptions?.[0]?.textContent||subjectField.value):subjectField.value);subjectChange.textContent=text('supportFlow.changeSubject',lang==='ht'?'Chanje':'Change');
 }
 subjectChange.onclick=()=>{if(pending())return;subjectEditing=true;renderSubject();subjectField.focus({preventScroll:true});};
 function chooseTopic(id){
  const topic=topics[id];if(!topic||pending())return;topicId=id;contact=false;helpTitle.dataset.i18n=topic.key;helpTitle.textContent=text(topic.key,topic.label);steps.replaceChildren();for(const [key,fallback] of topic.steps)steps.append(node('li','supportFlow.'+key,fallback));videos.scrollLeft=0;render();helpTitle.focus({preventScroll:true});
 }
 function openContact({subject,focus=true}={}){
  if(pending()){contact=true;render();return false;}
  const field=form.elements.subject;if(subject&&(!field.value||field.value===autoSubject)){field.value=subject;autoSubject=subject;subjectEditing=false;}
  contact=true;render();if(focus&&!support.hidden){const first=['name','email','subject','message'].map(key=>form.elements[key]).find(input=>input&&!String(input.value||'').trim())||form.elements.message;first?.focus({preventScroll:true});form.scrollIntoView?.({block:'start',behavior:'auto'});}return true;
 }
 form.elements.subject.addEventListener('input',()=>{autoSubject='';});form.elements.subject.addEventListener('change',()=>{autoSubject='';subjectEditing=!subjectField.value;renderSubject();if(contact&&subjectField.value&&!support.hidden)subjectChange.focus({preventScroll:true});});
 form.addEventListener('reset',()=>queueMicrotask(()=>{topicId='';contact=false;autoSubject='';subjectEditing=false;render();}));
 form.addEventListener('form-busy-changed',render);
 new MutationObserver(render).observe(form,{attributes:true,attributeFilter:['data-busy','aria-busy']});
 new MutationObserver(renderGuides).observe(videos,{childList:true});
 window.addEventListener('support-guides-ready',renderGuides);document.addEventListener('visibilitychange',renderGuides);
 window.addEventListener('app-language-changed',renderSubject);
 window.supportGuidedFlow={render,openContact};render();
})();
