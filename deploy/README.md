# VPS deploy (nginx + HTTPS + password)

Publish the dashboard on a small VPS so others can open a URL and sign in with a
password. The Python app stays on **localhost**; **nginx** terminates HTTPS and
prompts for Basic Auth.

## What you need

- A VPS (Ubuntu 22.04/24.04 is fine) with a public IP
- A domain (or subdomain) pointed at that IP — e.g. `rec.example.org`
- SSH access as a user that can use `sudo`

## 1. Install packages

```bash
sudo apt update
sudo apt install -y nginx apache2-utils certbot python3-certbot-nginx git
```

## 2. Clone the app and copy data

```bash
sudo mkdir -p /opt/rec-dashboard
sudo chown "$USER":"$USER" /opt/rec-dashboard
git clone https://github.com/noorani786/rec-dashboard.git /opt/rec-dashboard
# Copy your private CSVs onto the server (never commit them):
#   scp -r data/central you@your-vps:/opt/rec-dashboard/data/
```

## 3. Create the shared password (nginx)

Pick a strong password. This is what people type in the browser.

```bash
sudo htpasswd -c /etc/nginx/.htpasswd-rec rec
# Enter password when prompted.
# To add another user later (don't use -c — that resets the file):
#   sudo htpasswd /etc/nginx/.htpasswd-rec otheruser
sudo chmod 640 /etc/nginx/.htpasswd-rec
sudo chown root:www-data /etc/nginx/.htpasswd-rec
```

## 4. Install the systemd service

```bash
sudo cp /opt/rec-dashboard/deploy/rec-dashboard.service /etc/systemd/system/
sudo nano /etc/systemd/system/rec-dashboard.service   # set User=/Group= to your SSH user
sudo systemctl daemon-reload
sudo systemctl enable --now rec-dashboard
sudo systemctl status rec-dashboard
```

The app listens on `127.0.0.1:8000` only (not on the public internet).

## 5. Configure nginx

```bash
# Edit the server_name in the file first if you like, then:
sudo cp /opt/rec-dashboard/deploy/nginx-rec-dashboard.conf /etc/nginx/sites-available/rec-dashboard
sudo nano /etc/nginx/sites-available/rec-dashboard   # set your domain
sudo ln -sf /etc/nginx/sites-available/rec-dashboard /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 6. HTTPS with Let's Encrypt

```bash
sudo certbot --nginx -d rec.example.org
```

Certbot will adjust the nginx site for TLS. Renewals are automatic via systemd timer.

## 7. Share access

Give people:

- URL: `https://rec.example.org`
- Username: `rec` (or whatever you created with `htpasswd`)
- Password: the one you set

The browser will show a login dialog before the dashboard loads.

## Updating

```bash
cd /opt/rec-dashboard
git pull
# replace/add CSVs under data/<region>/<year>/
sudo systemctl restart rec-dashboard
```

## Optional: also password-protect the Python app

Normally nginx alone is enough because the app is not publicly bound. If you want
a second gate, set `DASHBOARD_PASSWORD` in the systemd unit (see comments in
`rec-dashboard.service`). Avoid enabling both nginx auth *and* app auth unless
you intentionally want two challenges.

## Security notes

- Keep CSVs only on the server; they stay gitignored.
- Use a strong shared password; rotate it if someone leaves the group.
- Prefer HTTPS only (certbot).
- Firewall: allow 22, 80, 443 — do **not** open port 8000 publicly.
