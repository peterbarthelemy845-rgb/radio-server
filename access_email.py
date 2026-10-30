"""Send station owner access codes using the configured mailbox."""
import os
import logging
import smtplib
import ssl
import requests
import re
from urllib.parse import quote
from email.message import EmailMessage

def send_station_message(email, subject, body):
    host = os.environ.get('SMTP_HOST', 'smtp.office365.com').strip()
    username = os.environ.get('SMTP_USERNAME', 'info@radiolavoixdivine.com').strip()
    password = os.environ.get('SMTP_PASSWORD', '')
    modern = os.environ.get('OWNER_MAIL_TRANSPORT', 'smtp').strip().lower() == 'graph'
    if modern and not all(os.environ.get(key) for key in ('MS_TENANT_ID','MS_CLIENT_ID','MS_CLIENT_SECRET')):
        logging.getLogger(__name__).warning('Owner email skipped: Graph configuration incomplete')
        return False
    if not modern and (not host or not username or not password):
        logging.getLogger(__name__).warning("Owner email skipped: SMTP configuration incomplete")
        return False
    try:
        port = int(os.environ.get('SMTP_PORT', '587'))
        message = EmailMessage()
        message['From'] = 'Radio La Voix Divine <info@radiolavoixdivine.com>'
        message['To'] = email
        message['Subject'] = subject
        message.set_content(body)
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


def send_access_code(email, code, station_name):
    return send_station_message(email, 'Your private station owner login',
        f'Station: {station_name}\n\nYour private owner login code: {code}\n\nSign in at https://www.radiolavoixdivine.com/owner/login using your email and this code. Keep it private. This is NOT the station code shared with listeners.\n')

def send_listener_code(email, code, station_name):
    return send_station_message(email, 'Your station code: '+code,
        f'Your station: {station_name}\n\nYour listener station code is: {code}\n\nShare your station page on WhatsApp or social media: https://www.radiolavoixdivine.com/station/{code}\n\nShare this station code with all your listeners. It identifies your station, not a customer or device. The same code can be used on multiple radios.\n\nOn the radio: tap Add Station, enter {code}, then tap Add. The radio saves your station and streams audio directly from your stream URL.\n\nTo update your cover art, stream URL/IP address, or bio, visit https://www.radiolavoixdivine.com/#add-station and choose Already registered? Edit your station. Enter this email and station code to receive a private verification code.\n')
