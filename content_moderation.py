"""Text screening and private, administrator-reviewed station artwork."""
import hashlib,hmac,json,posixpath,re,time,unicodedata
from flask import request,session,abort,jsonify,render_template,redirect

# Deliberately conservative: context-dependent terms are left for human review.
WORDS=('fuck','fucking','fucker','motherfucker','shit','bullshit','asshole','bitch','cunt','porn','porno','pornography','xxx','blowjob','merde','putain','salope','connard','enculer','getmaman','kokomaman','kalanmaman')
PATTERNS=[re.compile(r'(?<![a-z0-9])'+r'[^a-z0-9]*'.join(re.escape(c)+r'+' for c in word)+r'(?![a-z0-9])') for word in WORDS]

PATTERNS += [re.compile(pattern) for pattern in (r"(?<![a-z0-9])f[*#]{1,3}k(?![a-z0-9])",r"(?<![a-z0-9])sh[*#]{1,2}t(?![a-z0-9])",r"(?<![a-z0-9])p[*#]{1,2}rn(?![a-z0-9])")]

def review_version(station):
 fields={key:station.get(key,"") for key in ("station_code","listener_code","contact_email","name","subtitle","bio","url","logo_url","wallpaper")}
 return hashlib.sha256(json.dumps(fields,sort_keys=True,ensure_ascii=True).encode()).hexdigest()

def text_error(fields):
 for label,value in fields.items():
  if not isinstance(value,str):return 'Please enter plain text for '+label+'.'
  clean=unicodedata.normalize('NFKD',unicodedata.normalize('NFKC',value)).casefold()
  clean=''.join(c for c in clean if unicodedata.category(c) not in ('Mn','Cf'))
  clean=clean.translate(str.maketrans({'0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','@':'a','$':'s','!':'i'}))
  if any(pattern.search(clean) for pattern in PATTERNS):return label+' contains language that is not allowed. Please use family-friendly wording.'
 return ''

def station_error(station):
 return text_error({'Station name':station.get('name',''),'Station title':station.get('subtitle',''),'Bio':station.get('bio','')})

def public_upload_paths(radio):
 paths=set()
 for station in radio.load_station_store().get('custom_stations',[]):
  if station.get('suspended') or station.get('owner_suspended') or (station.get('email_verification_required') and not station.get('email_verified')):continue
  for field in ('logo_url','wallpaper'):
   if station.get(field):paths.add(station[field])
 return paths

def register_moderation(app,radio):
 from admin_security import valid_session
 from station_owners import check_token
 app.jinja_env.globals['station_review_version']=review_version
 app.jinja_env.globals['station_edit_review_version']=lambda s:review_version(dict(s,**s.get('pending_edit',{})))
 app.jinja_env.globals['station_content_edits']=lambda:[s for s in radio.load_station_store().get('custom_stations',[]) if s.get('pending_edit')]
 @app.before_request
 def content_guards():
  # Gate both the dedicated upload URL and normalized Flask static aliases.
  if request.endpoint in ('uploaded_station_image','static'):
   filename=str((request.view_args or {}).get('filename','')).replace('\\','/')
   normalized=posixpath.normpath(filename)
   if request.endpoint=='uploaded_station_image' or normalized.casefold().startswith('wallpapers/'):
    basename=normalized.rsplit('/',1)[-1]
    if not valid_session(session) and '/static/wallpapers/'+basename not in public_upload_paths(radio):abort(404)
  if request.method=='POST' and request.endpoint in ('api_add_station','edit_registered_station','admin_edit_station'):
   data=(request.get_json(silent=True) if request.is_json else request.form) or {}
   fields={'Station name':data.get('name',''),'Station title':data.get('subtitle') or data.get('website') or data.get('title') or '', 'Bio':data.get('bio') or data.get('description') or ''}
   if any(isinstance(value,str) and len(value)>4000 for value in fields.values()):message='Station text is too long.'
   else:message=text_error(fields)
   if message:
    if request.endpoint=='api_add_station' and (request.is_json or request.headers.get('X-Requested-With')=='fetch'):return jsonify(status='error',message=message),400
    return render_template('content_rejected.html',message=message),400
  if request.method=='POST' and request.endpoint=='admin_approve':
   store=radio.load_station_store();index=(request.view_args or {}).get('index',-1);rows=store.get('pending_stations',[])
   if 0<=index<len(rows):
    if not hmac.compare_digest(request.form.get("review_version", ""),review_version(rows[index])):abort(409,"The submission changed. Reload and review it again.")
    error=station_error(rows[index])
    if error:return render_template('content_rejected.html',message=error),400
 @app.after_request
 def private_art_response(response):
  name=str((request.view_args or {}).get('filename','')).replace('\\','/')
  if request.endpoint=='uploaded_station_image' or (request.endpoint=='static' and posixpath.normpath(name).casefold().startswith('wallpapers/')):
   response.headers['Cache-Control']='private, no-store';response.headers['X-Content-Type-Options']='nosniff'
  return response
 @app.post('/admin/content-edit/<code>/<decision>')
 def review_station_content_edit(code,decision):
  if not valid_session(session) or session.get('admin_role')!='full':abort(403)
  check_token()
  if decision not in ('approve','reject'):abort(400)
  store=radio.load_station_store();station=next((s for s in store.get('custom_stations',[]) if s.get('listener_code')==code),None)
  if not station or not station.get('pending_edit'):abort(404)
  draft=station['pending_edit']
  if not hmac.compare_digest(request.form.get('review_version',''),review_version(dict(station,**draft))):abort(409,'The proposed content changed. Reload and review it again.')
  if decision=='approve':
   error=station_error(dict(station,**draft))
   if error:return render_template('content_rejected.html',message=error),400
   if any(s.get('url')==draft.get('url') and s.get('listener_code')!=code for group in ('custom_stations','pending_stations') for s in store.get(group,[])):abort(409,'This stream URL is already registered.')
   station.update({key:draft[key] for key in ('url','bio','logo_url') if key in draft})
   station['content_reviewed_at']=int(time.time())
  station.pop('pending_edit',None);radio.save_station_store(store)
  return redirect('/admin/pending')
