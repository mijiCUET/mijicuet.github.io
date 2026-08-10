#!/usr/bin/env python3
from pathlib import Path
import base64, hashlib, json, re, subprocess, sys, tempfile

ROOT=Path(__file__).resolve().parent
HTML=ROOT/'index.html'; BACK=ROOT/'math-auth-backend'; errors=[]; notes=[]
def check(ok,msg):
    print(('PASS' if ok else 'FAIL')+'  '+msg)
    if not ok: errors.append(msg)

def sha(t): return "'sha256-"+base64.b64encode(hashlib.sha256(t.encode()).digest()).decode()+"'"

s=HTML.read_text(encoding='utf-8')
style=re.search(r'<style>(.*?)</style>',s,re.S); script=re.search(r'<script>(.*?)</script>',s,re.S); cspm=re.search(r'Content-Security-Policy" content="([^"]+)',s)
check(bool(style and script and cspm),'single inline style/script and CSP are present')
if style and script and cspm:
    csp=cspm.group(1); check(sha(script.group(1)) in csp,'frontend script CSP hash matches'); check(sha(style.group(1)) in csp,'frontend style CSP hash matches')
    check("unsafe-inline" not in csp and "unsafe-eval" not in csp,'CSP does not allow unsafe-inline/unsafe-eval script')
    check('connect-src https://math-auth.YOUR-WORKERS-SUBDOMAIN.workers.dev' in csp or re.search(r'connect-src https://math-auth\.[A-Za-z0-9.-]+\.workers\.dev',csp),'CSP connect-src is narrowed to math-auth Worker')
    with tempfile.NamedTemporaryFile('w',suffix='.js',delete=False,encoding='utf-8') as f: f.write(script.group(1)); js=f.name
    r=subprocess.run(['node','--check',js],capture_output=True,text=True); check(r.returncode==0,'frontend JavaScript syntax passes node --check')
check('\x00' not in s,'frontend contains no NUL byte')
check(not re.search(r'<[^>]+\son[a-zA-Z]+\s*=',s),'frontend contains no inline HTML event-handler attributes')
check(not re.search(r'\beval\s*\(|new\s+Function\s*\(|document\.write\s*\(',s),'frontend contains no eval/new Function/document.write')
OLD_SERVICE='grade3-'+'math-auth'
check(OLD_SERVICE not in s,'legacy Worker service name absent from frontend')
check('grade3MathApiToken' not in s and 'grade3MathApiProfile' not in s and 'mathAuthApiToken.v1' in s and 'mathAuthApiProfile.v1' in s,'browser session-storage keys use the math-auth name')
check('!/your-workers-subdomain/i.test(API_BASE)' in s,'placeholder Worker origin is not treated as configured')
check(all(x in s for x in ['id="headerHomeBtn"','id="headerLessonBtn"','id="headerPracticeBtn"','id="headerTestBtn"','id="headerLoginBtn"','id="headerCreateBtn"','id="accountStatus"','id="headerLogoutBtn"']),'Home/Lesson/Practice/Test and account header controls are present')
check('id="who"' not in s and '>Your name <' not in s,'legacy optional real-name session field is absent')
check(s.find('id="privacyAgree"') < s.find('id="captchaAnswer"') < s.find('id="regUser"') < s.find('id="regPass"') < s.find('id="mfaQr"') < s.find('id="mfaKey"'),'registration stages and QR-before-manual-key order are present')
check('if(isLocallyAuthenticated())' in s and 'prepareLogin(kind);' in s,'Practice/Test navigation reuses a validated session and otherwise requires login')
check('engineTopicsForLevel' in s and 'allLevelGenerators' in s and 'return GEN.filter(g=>g.minL<=L).concat(EXTRAGEN.filter(g=>g.minL<=L),GEOGEN.filter(g=>g.minL<=L),MULTIGEN.filter(g=>g.minL<=L),OLYGEN.filter(g=>g.minL<=L));' in s,'level topic dashboard is derived from the generator engine')
check('if(bytes.length>106)throw new Error("Authenticator QR payload is too long.")' in s,'local QR encoder has an explicit capacity guard')
check(all(x in s for x in ['dashLevel','dashAttempted','dashCorrect','dashAccuracy','dashSessions','dashTopics']),'learner performance dashboard metrics are present')
check(all(x in s for x in ['id="dashboardView"','id="lessonView"','id="gameView"','id="dashEnergy"','id="dashBadges"']),'dashboard, lessons, game, energy and badge UI are present')
check('const LESSON_UNITS=[' in s and all(x in s for x in ['Perimeter & Area','Points, Lines, Rays & Angles','3D Solids, Nets & Cross-sections','Counting & Infinity Lab']),'authentic visual lesson units are bundled')
check('pc===100&&m.unitPerfect' in s and all(x in s for x in ["name:'Familiar'","name:'Proficient'","name:'Mastered'"]),'topic mastery implements Familiar/Proficient/Mastered rule')
check('function energyCoinSvg()' in s and 'function startGame()' in s and 'function makeGameQuestion()' in s and 'numberRain' in s,'energy coin and timed Math Challenge game are present')
check('grade3LearningHub.v1.' in s and 'localStorage.setItem(LEARNING_STATE_PREFIX+p.username' in s,'new gamification metadata is namespaced per pseudonymous username')
check('queueProgressWrite' in s and 'progressWriteChain' in s,'frontend serializes progress/unlock writes to reduce repository conflicts')
check('clearRegistrationSecrets' in s and 'clearLoginChallenge' in s and 'if(view!=="registerView")clearRegistrationSecrets();' in s,'transient password/TOTP enrollment and login-challenge data are cleared when leaving auth views')
check('if(finishing)return;finishing=true;' in s,'duplicate result/progress submission guard is present')
check('sessionValidated&&!!authToken()&&!!profileData()' in s and 'refreshRemoteSession().finally(route);' in s,'protected UI requires a server-validated session after reload')
check('if(v==="setup"&&!isLocallyAuthenticated())' in s and 'if(!isLocallyAuthenticated()){prepareLogin(mode==="test"?"test":"practice");return;}' in s,'direct setup/session start cannot bypass normal login state')
check('if(v==="registerView"){show("registerView");makeCaptcha();return;}' in s and 'captchaExpected=null; captchaVerified=false; captchaChallenge="";' in s,'registration receives a fresh server CAPTCHA and stale registration state is cleared')
check('purple comet 47 river!' in s and 'CONTEXT_PASSWORD_TERMS_CLIENT' in s,'published password example and service-specific weak passwords are blocked client-side')

src=(BACK/'src/index.ts').read_text(encoding='utf-8'); pkg=json.loads((BACK/'package.json').read_text()); wr=(BACK/'wrangler.jsonc').read_text()
check("const SERVICE = 'math-auth'" in src and '"name": "math-auth"' in wr,'backend/Worker service name is math-auth')
check('const PASSWORD_ITERATIONS = 600_000' in src and 'PASSWORD_PEPPER' in src,'password derivation uses 600k PBKDF2 + pepper')
check('new Set([env.SESSION_SECRET, env.DATA_ENCRYPTION_KEY, env.PASSWORD_PEPPER]).size !== 3' in src,'backend rejects reused cryptographic secrets')
check('CONTEXT_PASSWORD_TERMS' in src and 'purple comet 47 river!' in src,'backend blocks the published example and context-specific weak passwords')
check("!/^[a-f0-9]{40,64}$/i.test(data.sha)" in src,'GitHub record SHA is validated before optimistic-concurrency writes')
check('ttlByType' in src and 'session: SESSION_TTL_SEC' in src,'session token TTL validator accepts the intended 2-hour session')
check("app.post('/api/logout'" in src and 'sessionMatches' in src,'server-backed logout/revocation exists')
check('PRIVACY_NOTICE_VERSION' in src and 'consent: { noticeVersion:' in src,'privacy acknowledgement is persisted')
check("const body = { ...payload, iss: SERVICE, iat: now, exp: now + ttlSec }" in src,'sealed-token reserved fields are authoritative')
check('appTokenCache.scope === cacheScope' in src,'GitHub App token cache is scope-keyed')
check('read:user:${String(p.sub)}' in src,'authenticated profile reads are rate-limited')
check('body.getReader()' in src and 'MAX_BODY_BYTES' in src,'streaming request body cap exists')
check('const allowed = origin === c.env.FRONTEND_ORIGIN' in src,'production CORS is exact-origin')
check('const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}`' in src and '&algorithm=' not in src[src.find('const uri = `otpauth://totp/'):src.find('const uri = `otpauth://totp/')+220],'authenticator provisioning URI fits the bundled local QR encoder and uses standard TOTP defaults')
check('AUTH_IP_RATE_LIMITER' in wr and 'AUTH_ACCOUNT_RATE_LIMITER' in wr and 'PROGRESS_RATE_LIMITER' in wr,'three rate-limit bindings configured')
check(pkg.get('dependencies',{}).get('hono')=='4.12.32','Hono direct dependency exact-pinned')
check(pkg.get('devDependencies',{}).get('wrangler')=='4.114.0','Wrangler exact-pinned')
check(OLD_SERVICE not in src+wr,'legacy Worker service name absent from backend')

front_eps=set(re.findall(r'apiCall\("(/api/[^"?]+)',s))
back_eps=set(re.findall(r"app\.(?:get|post)\('(/api/[^']+)'",src))
check(front_eps <= back_eps,'every frontend API call has a backend route')
if front_eps-back_eps: print('Missing routes:',sorted(front_eps-back_eps))

secret_patterns=[r'gh[pousr]_[A-Za-z0-9]{20,}',r'github_pat_[A-Za-z0-9_]{20,}',r'-----BEGIN (?:RSA )?PRIVATE KEY-----\s+[A-Za-z0-9+/]']
release_text='\n'.join(p.read_text(errors='ignore') for p in [HTML,BACK/'src/index.ts',BACK/'.dev.vars.example',BACK/'wrangler.jsonc'])
check(not any(re.search(p,release_text,re.S) for p in secret_patterns),'no obvious live GitHub token/private key embedded in release source')

print('\nRESULT:', 'PASS' if not errors else f'FAIL ({len(errors)} issue(s))')
if errors: sys.exit(1)
