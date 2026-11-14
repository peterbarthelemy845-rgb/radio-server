// Reviewed help text already published in app-language.js and
// support-guided-flow.js. User questions and database records cannot add guides.
// Keep these steps aligned with the public help pages when radio behavior changes.
const guides=[
 {id:'wifi-connect',title:'Connect your radio to Wi-Fi',steps:[
  'On your radio, open Settings → Wi-Fi.',
  'Choose your 2.4 GHz network and enter its password on the radio.',
  'Keep the radio near your router while it connects.',
  'Wait for the home screen. If setup fails, check the password on the radio and try again.'
 ],ht:{title:'Konekte radyo ou ak Wi-Fi',steps:[
  'Sou radyo ou, louvri Anviwònman → Wi-Fi.',
  'Chwazi rezo 2.4 GHz ou epi antre modpas li sou radyo a.',
  'Kenbe radyo a toupre routeur ou pandan l ap konekte.',
  'Tann ekran dakèy la. Si koneksyon an pa mache, verifye modpas la sou radyo a epi eseye ankò.'
 ]}},
 {id:'no-sound',title:'No sound',steps:[
  'Turn up the volume on your radio.',
  'Try another station. If only one fails, report that station.'
 ],ht:{title:'Pa gen son',steps:[
  'Monte volim radyo ou.',
  'Eseye yon lòt estasyon. Si yon sèl pa mache, rapòte pwoblèm estasyon sa a.'
 ]}},
 {id:'radio-freezing',title:'Radio freezing',steps:[
  'Turn the radio off, wait 10 seconds, then turn it on again.',
  'If it keeps freezing, contact support.'
 ],ht:{title:'Radyo a bloke',steps:[
  'Etenn radyo a, tann 10 segonn, epi limen li ankò.',
  'Si li kontinye bloke, kontakte sipò.'
 ]}},
 {id:'add-station',title:'Add a station from the website',steps:[
  'Keep your radio on and connected to Wi-Fi. Open Radio and tap a station.',
  'If your phone is not linked, enter the Device Code shown on your radio and tap Add station.',
  'For a new phone, match the confirmation numbers on the phone and radio.',
  'Tap Allow on the physical radio. Deny requests you did not start.',
  'The station is added automatically. No extra confirmation is needed.',
  'Wait for Station added, then tap Done. Linked phones skip the linking steps.'
 ],ht:{title:'Ajoute yon estasyon sou sit la',steps:[
  'Kite radyo a limen epi konekte ak Wi-Fi. Louvri Radyo epi tape yon estasyon.',
  'Si telefòn ou poko konekte, antre kòd aparèy ki sou radyo a epi tape Ajoute estasyon.',
  'Pou yon nouvo telefòn, verifye nimewo konfimasyon sou telefòn nan ak radyo a menm.',
  'Tape Allow sou radyo a. Chwazi Deny pou demann ou pa t fè.',
  'Estasyon an ajoute otomatikman. Ou pa bezwen konfime ankò.',
  'Tann Estasyon ajoute, epi tape Fini. Telefòn ki deja konekte yo sote etap koneksyon yo.'
 ]}},
 {id:'device-code-reset',title:'Reset the Device Code',steps:[
  'Resetting the Device Code unlinks every phone. Start on the physical radio.',
  'On the radio’s home screen, tap the large Device Code.',
  'Tap Reset code to change the code and disconnect all linked phones.',
  'Keep Wi-Fi connected. Wait for the new code; a reset lock lasts 60 seconds.',
  'Use the new Device Code to reconnect. Match the number and tap Allow on the radio.'
 ],ht:{title:'Reyajiste kòd aparèy la',steps:[
  'Reyajiste kòd aparèy la dekonekte tout telefòn. Kòmanse sou radyo a.',
  'Sou ekran dakèy radyo a, tape gwo kòd aparèy la.',
  'Tape Reset code pou chanje kòd la epi dekonekte tout telefòn.',
  'Kite Wi-Fi konekte. Tann nouvo kòd la; ou dwe tann 60 segonn anvan yon lòt reyajisteman.',
  'Sèvi ak nouvo kòd aparèy la pou rekonekte. Verifye nimewo a epi tape Allow sou radyo a.'
 ]}},
 {id:'station-signin',title:'Sign in to your station',steps:[
  'Sign in with your registered email and Station code.',
  'Enter the private email code on the sign-in screen to edit your station. Do not send that code to the assistant.'
 ],ht:{title:'Konekte ak kont estasyon ou',steps:[
  'Konekte ak imèl ki anrejistre a ak Kòd estasyon ou.',
  'Antre kòd prive ou resevwa nan imèl la sou ekran koneksyon an pou modifye estasyon ou. Pa voye kòd sa a bay asistan an.'
 ]}},
 {id:'station-logo',title:'Update your station logo',steps:[
  'Sign in with your registered email and Station code. Enter the private email code on the sign-in screen.',
  'In the station editor, choose a replacement image under Cover art.',
  'Tap Save changes. The replacement artwork goes through the existing content review.'
 ],ht:{title:'Mete logo estasyon ou ajou',steps:[
  'Konekte ak imèl ki anrejistre a ak Kòd estasyon ou. Antre kòd prive ou resevwa nan imèl la sou ekran koneksyon an.',
  'Nan editè estasyon an, chwazi yon nouvo imaj nan seksyon Cover art.',
  'Tape Save changes. Nouvo imaj la pase nan egzamen kontni ki deja an plas la.'
 ]}},
 {id:'station-stream',title:'Update your station stream',steps:[
  'Sign in with your registered email and Station code. Enter the private email code on the sign-in screen.',
  'In the station editor, choose Change stream, then select Icecast, SHOUTcast, or a direct Stream URL.',
  'Enter the public listening details. Never enter an encoder or administrator password.',
  'Test the exact public listening URL you want to save.',
  'After the stream test passes, tap Save changes. The existing review still applies.'
 ],ht:{title:'Mete difizyon estasyon ou ajou',steps:[
  'Konekte ak imèl ki anrejistre a ak Kòd estasyon ou. Antre kòd prive ou resevwa nan imèl la sou ekran koneksyon an.',
  'Nan editè estasyon an, chwazi Change stream, epi chwazi Icecast, SHOUTcast oswa yon Stream URL dirèk.',
  'Antre enfòmasyon piblik pou koute a. Pa janm antre yon modpas ankodè oswa administratè.',
  'Teste URL piblik egzak ou vle anrejistre pou koute a.',
  'Lè tès difizyon an reyisi, tape Save changes. Egzamen ki deja an plas la toujou aplike.'
 ]}}
];
export const approvedGuides=Object.freeze(guides.map(({ht,...guide})=>Object.freeze({...guide,steps:Object.freeze(guide.steps),content:guide.steps.join('\n'),translations:Object.freeze({ht:Object.freeze({...ht,steps:Object.freeze(ht.steps)})})})));
export function getApprovedGuide(id,language='en'){
 const guide=approvedGuides.find(item=>item.id===id);if(!guide)return null;
 const translated=language==='ht'?guide.translations.ht:guide;
 return {id:guide.id,title:translated.title,steps:[...translated.steps],content:translated.steps.join('\n')};
}
