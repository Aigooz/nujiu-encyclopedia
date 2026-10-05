# -*- coding: utf-8 -*-
"""B站扫码登录：生成二维码 → 用户手机APP扫码 → Cookie自动写入config.ini。"""
import os, sys, json, time, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

def _get_qrcode():
    url = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read())
    return data['data']['url'], data['data']['qrcode_key']

def _poll(qrcode_key):
    url = 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll'
    full = f'{url}?{urllib.parse.urlencode({"qrcode_key": qrcode_key})}'
    req = urllib.request.Request(full, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read())
    return data, r.headers.get_all('Set-Cookie')

def _save_cookie(cookie_str):
    cfg = os.path.join(ROOT, 'config.ini')
    with open(cfg, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    with open(cfg, 'w', encoding='utf-8') as f:
        for line in lines:
            if line.strip().startswith('cookie ='):
                f.write(f'cookie = {cookie_str}\n')
            else:
                f.write(line)

def main():
    try:
        import qrcode
    except ImportError:
        os.system(f'"{sys.executable}" -m pip install qrcode[pil] --quiet')
        import qrcode

    login_url, qrcode_key = _get_qrcode()
    qr = qrcode.QRCode(version=1, box_size=8, border=2)
    qr.add_data(login_url)
    qr.make(fit=True)
    qr_path = os.path.join(HERE, 'qr.png')
    qr.make_image(fill_color='black', back_color='white').save(qr_path)
    print(f'二维码: {qr_path}')
    print('请用手机B站APP -> 扫一扫 -> 扫描二维码')

    for i in range(90):
        time.sleep(2)
        data, cookies = _poll(qrcode_key)
        code = data['data']['code']
        if code == 0:
            parts = [c.split(';')[0].strip() for c in (cookies or []) if '=' in c]
            cookie_str = '; '.join(parts)
            _save_cookie(cookie_str)
            print(f'登录成功! Cookie({len(cookie_str)}字符)已保存到config.ini')
            os.remove(qr_path)
            return
        elif code == 86038:
            print('二维码已过期，请重新运行'); return
        elif code == 86090:
            print('已扫码，请在手机上确认...')
        elif code == 86091:
            print('确认中...')
    print('超时')

if __name__ == '__main__':
    main()
