"""Add privacy-focused website metrics only to public browsing pages."""
from flask import request, render_template

PUBLIC_ENDPOINTS = {'index', 'add_station_page', 'station_share'}
PRIVATE_PARAMETERS = {'token', 'code', 'radio_code', 'claim_id', 'pin'}


def register_public_analytics(app):
    @app.after_request
    def public_page_beacon(response):
        if (request.method != 'GET' or request.endpoint not in PUBLIC_ENDPOINTS
                or response.status_code != 200 or response.mimetype != 'text/html'
                or response.is_streamed or response.direct_passthrough
                or PRIVATE_PARAMETERS.intersection(request.args)):
            return response
        html = response.get_data(as_text=True)
        if '</body>' in html and 'data-cf-beacon=' not in html:
            before, after = html.rsplit('</body>', 1)
            response.set_data(before + render_template('analytics_beacon.html') + '</body>' + after)
        return response
