import re

content = open(r'D:\projets IT\SR\js\solo.js', 'r', encoding='utf-8').read()

old = ("        this.showErr(''); return true;\n"
       "    validateStep2() {\n"
       "        document.querySelectorAll('.tab').forEach(t => {\n"
       "            t.addEventListener('click', () => {\n"
       "                document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));\n"
       "                t.classList.add('active');\n"
       "                document.getElementById(t.dataset.tab + 'Form').style.display = 'block';\n"
       "                document.getElementById(t.dataset.tab === 'login' ? 'registerForm' : 'loginForm').style.display = 'none';\n"
       "            });\n"
       "        });\n"
       "        const prefixMap = { ML:'+223',CI:'+225',SN:'+221',BF:'+226',GN:'+224',CM:'+237',BJ:'+229',TG:'+228',NE:'+227',TD:'+235' };\n"
       "        document.getElementById('regCountry').addEventListener('change', function() {\n"
       "            const p = prefixMap[this.value] || '+223';\n"
       "            document.getElementById('phonePrefix').textContent = p;\n"
       "            var phoneInput = document.getElementById('regPhone');\n"
       "            phoneInput.dataset.country = this.value;\n"
       "            if (phoneInput) phoneInput.focus();\n"
       "        });\n"
       "        document.getElementById('regCountry').dispatchEvent(new Event('change'));\n"
       "        document.getElementById('regSubmit')?.addEventListener('click', function(e) { e.preventDefault(); B.registerStep3(); });\n"
       "    },")

new = "        this.showErr(''); return true;\n    },"

if old in content:
    content = content.replace(old, new)
    open(r'D:\projets IT\SR\js\solo.js', 'w', encoding='utf-8').write(content)
    print('FIXED')
else:
    print('NOT FOUND - checking content around line 105')
    lines = content.split('\n')
    for i in range(102, 130):
        if i < len(lines):
            print(f"{i+1}: {lines[i][:100]}")
