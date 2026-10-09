"""Send station owner access codes using the configured mailbox."""
import os
import logging
import smtplib
import ssl
import requests
import re
from urllib.parse import quote
from email.message import EmailMessage

def send_access_code(email, code, station_name):
    host = os.environ.get('SMTP_HOST', 'smtp.office365.com').strip()
    username = os.environ.get('SMTP_USERNAME', 'info@radiolavoixdivine.com').strip()
    password = os.environ.get('SMTP_PASSWORD', '')
    modern = all(os.environ.get(key) for key in ('MS_TENANT_ID','MS_CLIENT_ID','MS_CLIENT_SECRET'))
    if not modern and (not host or not username or not password):
        logging.getLogger(__name__).warning("Owner email skipped: SMTP configuration incomplete")
        return False
    try:
        port = int(os.environ.get('SMTP_PORT', '587'))
        message = EmailMessage()
        message['From'] = 'Radio La Voix Divine <info@radiolavoixdivine.com>'
        message['To'] = email
        message['Subject'] = 'Your Radio La Voix Divine station access code'
        message.set_content(f'Welcome to Radio La Voix Divine!\n\nStation: {station_name}\n\nYour owner access code: {code}\n\nSign in at https://www.radiolavoixdivine.com/owner/login using this email address and your access code.\n\nKeep this code private. A station awaiting approval becomes publicly available after approval. If you already manage other stations, the same owner account covers them.\n\nFor help, contact info@radiolavoixdivine.com.\n')
        if modern:
            tenant=os.environ['MS_TENANT_ID']
            if not re.fullmatch(r'[A-Za-z0-9.-]+',tenant):
                return False
            token=requests.post('https://login.microsoftonline.com/'+tenant+'/oauth2/v2.0/token',data={'client_id':os.environ['MS_CLIENT_ID'],'client_secret':os.environ['MS_CLIENT_SECRET'],'scope':'https://graph.microsoft.com/.default','grant_type':'client_credentials'},timeout=15)
            token.raise_for_status()
            response=requests.post('https://graph.microsoft.com/v1.0/users/'+quote('info@radiolavoixdivine.com',safe='')+'/sendMail',headers={'Authorization':'Bearer '+token.json()['access_token']},json={'message':{'subject':message['Subject'],'body':{'contentType':'Text','content':message.get_content()},'toRecipients':[{'emailAddress':{'address':email}}]},'saveToSentItems':True},timeout=15)
            response.raise_for_status()
            return response.status_code == 202
        context = ssl.create_default_context()
        transport = smtplib.SMTP_SSL if port == 465 else smtplib.SMTP
        with transport(host, port, timeout=15, **({'context': context} if port == 465 else {})) as smtp:
            if port != 465:
                smtp.starttls(context=context)
            smtp.login(username, password)
            smtp.send_message(message)
        return True
    except (OSError, ValueError, KeyError, requests.RequestException, smtplib.SMTPException) as error:
        logging.getLogger(__name__).warning("Owner email failed: %s; SMTP status=%s", type(error).__name__, getattr(error, "smtp_code", "unavailable"))
        return False

