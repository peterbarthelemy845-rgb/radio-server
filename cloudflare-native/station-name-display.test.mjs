import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const css=read('./public/assets/station-name-display.css').replace(/\/\*[\s\S]*?\*\//g,''),rules=[...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)];

test('station capitalization is presentation-only and scoped away from bios, URLs, emails and general page content',()=>{
 assert.equal(rules.length,1);assert.equal(rules[0][2].trim(),'text-transform:uppercase');
 const selectors=rules[0][1].split(',').map(value=>value.trim());
 for(const selector of ['.station-tile-name','#shareName','#ownerName','#ticketStationName','#stationPlayerName','#stationBio #bioTitle','#reportResults > article > h2','#adminStations > article > h3 + p','#registerForm input[name="name"]','#editForm input[name="name"]'])assert.ok(selectors.includes(selector),selector);
 for(const selector of selectors)assert.match(selector,/^(?:\.station-(?:display|tile)-name|#(?:shareName|ownerName|ticketStationName|stationPlayerName)$|#stationBio #bioTitle$|#stationDeliveryStatus > span:first-child$|#(?:reportResults|adminStations) > article > (?:h2|h3 \+ p)$|#(?:registerForm|editForm) input\[name="name"\]$|#radioControlsDialog (?:select:has\(option\[data-i18n-skip\]\)|option\[data-i18n-skip\])$)/,'A broad selector could uppercase case-sensitive URLs or unrelated user content: '+selector);
 assert.doesNotMatch(css,/\.radio-current-station|#shareStationBio|stream_url|\[name="email"\]|\.card\s*[,\{]|\bbody\s*[,\{]/);
});

test('the app and standalone player load the shared station-name presentation without rewriting their content',()=>{
 const app=read('./public/index.html'),player=read('./public/station-player.html');
 for(const html of [app,player])assert.match(html,/<link\b[^>]*href="\/assets\/station-name-display\.css"/);
 assert.match(player,/<h1\b[^>]*id="stationPlayerName"[^>]*>La Voix Divine<\/h1>/);assert.match(player,/https:\/\/www\.radiolavoixdivine\.com\//);
});
