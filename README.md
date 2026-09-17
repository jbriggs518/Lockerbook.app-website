# lockerbook.app website

This static site gives App Store Connect the URLs it requires:

| Page | URL | Source |
|---|---|---|
| Home | https://lockerbook.app/ | `build.py` (`home()`, `SPORTS`, `SHOWCASE`, `FAQ`) |
| Press | https://lockerbook.app/press/ | `build.py` (`PRESS`) |
| Help (user guide) | https://lockerbook.app/help/ | `docs/user-manual/*.md` |
| Support (**App Store Support URL**) | https://lockerbook.app/support/ | `build.py` (`SUPPORT`) |
| Privacy (**Privacy Policy URL**) | https://lockerbook.app/privacy/ | `docs/legal/privacy-policy.md` |
| Terms | https://lockerbook.app/terms/ | `docs/legal/terms-of-use.md` |

The generated `.html` files are committed. Edit the Markdown or `build.py`, not the HTML.

**Design (D-038):** modeled on buildingroutines.com. It's a dark single page with a sticky nav, hero, sports grid, tap-through feature showcase, MaxPreps section, levels, privacy pillars, pricing, FAQ, and a closing call to action. `assets/style.css` uses system fonts only, and `assets/site.js` runs the menu and tabs; neither makes a third-party request.

**Real screenshots:** after you run `scripts/capture-screenshots.sh`, rebuild. The showcase switches from illustrations to your iPhone captures automatically (install Pillow to resize them).

**MaxPreps logos:** set `MAXPREPS_LOGOS = True` in `build.py` only after MaxPreps gives permission (see `marketing/brand/maxpreps/README.md`). Until then the site shows the name as text.

## Hosting: GitHub Pages (free)
GitHub Pages on a free plan only serves **public** repositories. The Lockerbook repo is private, so the site goes in its own small public repo, `jbriggs518/lockerbook.app`. That repo holds only these web pages: no app code and no student data.

### One-time setup
1. Create the public repo:
   - On github.com, click **New repository**.
   - Name: `lockerbook.app`
   - Visibility: **Public**
   - Don't add a README.
2. Clone it next to the app, then publish:
   ```bash
   cd ~/Projects
   git clone https://github.com/jbriggs518/lockerbook.app.git
   pip3 install markdown pillow
   ~/Projects/Lockerbook/website/publish.sh
   ```
   If the clone warns that the repository is empty, that's fine.
3. In the `lockerbook.app` repo on GitHub, open **Settings → Pages**:
   - Source: **Deploy from a branch** → `main` / `/ (root)` → **Save**
   - Custom domain: `lockerbook.app` → **Save**. The `CNAME` file already contains it.
4. In GoDaddy, open **Domain Portfolio → lockerbook.app → DNS**:
   - Delete the existing `A @` record (often labeled "Parked").
   - **Don't touch** the MX, TXT (SPF/DMARC), or Microsoft 365 records. Email depends on them.
   - Add these records:

   | Type | Name | Value | TTL |
   |---|---|---|---|
   | A | @ | 185.199.108.153 | 1 hour |
   | A | @ | 185.199.109.153 | 1 hour |
   | A | @ | 185.199.110.153 | 1 hour |
   | A | @ | 185.199.111.153 | 1 hour |
   | AAAA | @ | 2606:50c0:8000::153 | 1 hour |
   | AAAA | @ | 2606:50c0:8001::153 | 1 hour |
   | AAAA | @ | 2606:50c0:8002::153 | 1 hour |
   | AAAA | @ | 2606:50c0:8003::153 | 1 hour |
   | CNAME | www | jbriggs518.github.io | 1 hour |

   If a `www` CNAME already exists, edit it instead of adding a second one.
5. Wait for DNS to update (usually under an hour). Then turn on **Enforce HTTPS** in **Settings → Pages** once GitHub offers it.
6. Open https://lockerbook.app/privacy/ and https://lockerbook.app/support/. Once both load, paste them into App Store Connect.

### Updating the site
After you edit the docs, run:
```bash
~/Projects/Lockerbook/website/publish.sh
```
The script rebuilds the pages, copies them into `~/Projects/lockerbook.app`, and pushes.

DNS values are from GitHub Docs, "Managing a custom domain for your GitHub Pages site" (checked Sept 17, 2026).
