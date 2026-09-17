"""One install page + manifest per launcher.

On Android a PWA's identity is its MANIFEST PATH, so a page that links its own
manifest is a separately installable app with its own name and icon. That is what
turns "copy a link, open Chrome, find the ⋮ menu, rename it" into "tap Add to
Home Screen".

Each page is a stub whose only job is to be installable and then get out of the
way: open it in Chrome and it offers one button; open it once installed and it
sends you straight into the app.

The pages are static because GitHub Pages serves static files — the SPA's router
never sees these URLs, which is the point. They are doors, not rooms.
"""
import json, os

LAUNCHERS = [
    ('nerve',      'Nerve Center', 'Your whole world',            '/?view=dashboard',            '#C9A84E'),
    ('money',      'Money',        'Add an expense, see the numbers', '/?view=finance&sub=ledger', '#8FB8A8'),
    ('prospect',   'Prospecting',  'Today\u2019s hunt',           '/?view=prospecting&sub=today', '#C98A5E'),
    ('deals',      'Deals',        'Your pipeline',               '/?view=investor_pipeline',    '#B47EA8'),
    ('library',    'Library',      'Notes, docs and calls',       '/?view=documents',            '#5EA9B8'),
    ('brokerage',  'Brokerage',    'The office',                  '/?view=production',           '#9AA6C9'),
    ('tasks',      'Tasks',        'Everything on your plate',    '/?view=tasks',                '#CBA35C'),
    ('addexpense', 'Add Expense',  'Straight to the form',        '/?view=finance&sub=ledger',   '#8FB8A8'),
]

PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{title} &middot; PrismOS</title>
<link rel="manifest" href="/launch/{key}.webmanifest">
<meta name="theme-color" content="#100D09">
<link rel="apple-touch-icon" href="/launch/{key}-192.png">
<style>
  :root {{ color-scheme: dark; }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; min-height:100dvh; background:#100D09; color:#F6F1E7;
    font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    padding:28px calc(22px + env(safe-area-inset-right,0px)) calc(28px + env(safe-area-inset-bottom,0px)) calc(22px + env(safe-area-inset-left,0px));
    text-align:center; }}
  img.mark {{ width:104px; height:104px; border-radius:24px; }}
  h1 {{ font-family:Georgia,'Times New Roman',serif; font-weight:300; font-size:30px; margin:20px 0 4px; }}
  p  {{ color:#A89C88; font-size:14px; line-height:1.55; margin:0 0 22px; max-width:22rem; }}
  .rule {{ width:120px; height:1px; background:{accent}; opacity:.55; margin:2px 0 0; }}
  button, a.go {{ font:inherit; font-size:15px; font-weight:800; padding:14px 26px; border-radius:12px;
    border:0; cursor:pointer; background:{accent}; color:#100D09; text-decoration:none; display:inline-block; }}
  a.plain {{ color:#A89C88; font-size:13px; margin-top:18px; text-decoration:underline; }}
  .steps {{ color:#A89C88; font-size:13px; line-height:1.7; text-align:left; max-width:22rem;
    border:1px solid #2B2620; border-radius:12px; padding:14px 16px; }}
  .steps b {{ color:#F6F1E7; }}
  .hide {{ display:none; }}
</style>
</head>
<body>
  <img class="mark" src="/launch/{key}-192.png" alt="">
  <h1>{title}</h1>
  <div class="rule"></div>
  <p>{hint}</p>

  <button id="add" class="hide">Add to Home Screen</button>

  <!-- Shown when the browser will not offer an install: already installed, or a
       browser that does not support it. Telling someone the truth beats a button
       that does nothing when pressed. -->
  <div id="manual" class="steps hide">
    <b>To put this on your home screen</b><br>
    Open Chrome&rsquo;s <b>&#8942; menu</b> &rarr; <b>Add to Home screen</b>.<br>
    Already added it? Just open it from there.
  </div>

  <a class="go" id="open" href="{start}">Open {title}</a>
  <a class="plain" href="/">Back to PrismOS</a>

<script>
  // If this page is opened from an ALREADY-INSTALLED icon, there is nothing to
  // install — go straight where the person meant to go.
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (standalone) location.replace({start_js});

  var deferred = null;
  var addBtn = document.getElementById('add');
  var manual = document.getElementById('manual');

  window.addEventListener('beforeinstallprompt', function (e) {{
    e.preventDefault();
    deferred = e;
    addBtn.classList.remove('hide');
    manual.classList.add('hide');
  }});

  addBtn.addEventListener('click', async function () {{
    if (!deferred) return;
    deferred.prompt();
    try {{ await deferred.userChoice; }} catch (_) {{}}
    deferred = null;
    addBtn.classList.add('hide');
  }});

  window.addEventListener('appinstalled', function () {{
    addBtn.classList.add('hide');
    manual.classList.add('hide');
  }});

  // Chrome fires beforeinstallprompt within a moment of load, or not at all.
  // If it has not fired, show the manual route rather than an empty screen.
  setTimeout(function () {{
    if (!deferred && !standalone) manual.classList.remove('hide');
  }}, 1400);
</script>
</body>
</html>
"""

os.makedirs('public/launch', exist_ok=True)

for key, title, hint, start, accent in LAUNCHERS:
    # id pins the app's identity so start_url can change later without Chrome
    # treating it as a different app and orphaning the icon someone installed.
    manifest = {
        "id": f"/launch/{key}/",
        "name": f"{title} \u00b7 PrismOS",
        "short_name": title,
        "description": hint,
        "start_url": start,
        # Scope is the whole site: the launcher opens the real app, so every
        # in-app navigation must stay inside it or Android shows an out-of-scope
        # browser bar over the top of PrismOS.
        "scope": "/",
        "display": "standalone",
        "orientation": "any",
        "background_color": "#100D09",
        "theme_color": "#100D09",
        "icons": [
            {"src": f"/launch/{key}-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": f"/launch/{key}-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": f"/launch/{key}-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }
    with open(f'public/launch/{key}.webmanifest', 'w') as f:
        json.dump(manifest, f, indent=2)

    os.makedirs(f'public/launch/{key}', exist_ok=True)
    with open(f'public/launch/{key}/index.html', 'w') as f:
        f.write(PAGE.format(key=key, title=title, hint=hint, start=start,
                            start_js=json.dumps(start), accent=accent))

print(f'wrote {len(LAUNCHERS)} install pages + manifests')
