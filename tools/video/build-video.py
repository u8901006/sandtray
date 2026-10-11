# 合成教學影片（參數 therapist／client，預設 therapist）：Playwright 錄下的 webm＋旁白 mp3（依 marks.json 的開始秒數對齊）→ docs/guide/therapist-guide.mp4
# 另輸出 therapist-guide.srt 字幕（與畫面上燒入的字卡同文、時間取旁白長度）。
import json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GUIDE = sys.argv[1] if len(sys.argv) > 1 else 'therapist'
WORK = ROOT / 'working' / ('video' if GUIDE == 'therapist' else 'video-' + GUIDE)
SCRIPT = ROOT / 'tools' / 'video' / ('narration.json' if GUIDE == 'therapist' else GUIDE + '-narration.json')
OUT = ROOT / 'docs' / 'guide'


def ts(sec: float) -> str:
    ms = int(round(sec * 1000))
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}'


def card_times(video: Path) -> list[float]:
    # 片頭／片尾字卡是整頁米色漸層：取畫面下方中央 200×60 區塊的最暗灰階值，落在 196–214 即視為字卡畫面（4 fps 取樣）。
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(video), '-vf', 'fps=4,crop=200:60:540:640,scale=20:6,format=gray',
                          '-f', 'rawvideo', '-'], capture_output=True, check=True).stdout
    frames = [raw[i:i + 120] for i in range(0, len(raw), 120)]
    return [n / 4 for n, f in enumerate(frames) if 196 <= min(f) <= 214]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    video = Path((WORK / 'video-path.txt').read_text(encoding='utf-8').strip())
    marks = json.loads((WORK / 'marks.json').read_text(encoding='utf-8'))['marks']
    durations = json.loads((WORK / 'tts' / 'durations.json').read_text(encoding='utf-8'))
    steps = {s['id']: s for s in json.loads(SCRIPT.read_text(encoding='utf-8'))}
    if len(marks) != len(steps):
        print(f'marks {len(marks)} != steps {len(steps)}：錄影未完整，停止', file=sys.stderr)
        return 1
    # Playwright 錄影在高負載下時間軸會比牆鐘慢（實測 160 s 漂移約 2.8 s）：以片頭、片尾字卡出現時間做線性校正。
    cards = card_times(video)
    intro, outro = marks[0]['at'], marks[-1]['at']
    v_intro = cards[0]
    v_outro = next(t for t in cards if t > v_intro + (outro - intro) * 0.9)
    scale = (v_outro - v_intro) / (outro - intro)
    print(f'calibration: intro {intro}->{v_intro}, outro {outro}->{v_outro}, scale {scale:.4f}')
    for mark in marks:
        mark['at'] = v_intro + (mark['at'] - intro) * scale - 0.3
    inputs, filters = ['-i', str(video)], []
    for i, mark in enumerate(marks, start=1):
        inputs += ['-i', str(WORK / 'tts' / f"{mark['id']}.mp3")]
        delay = int(mark['at'] * 1000) + 300
        filters.append(f'[{i}:a]adelay={delay}|{delay}[a{i}]')
    mix = ''.join(f'[a{i}]' for i in range(1, len(marks) + 1))
    filters.append(f'{mix}amix=inputs={len(marks)}:normalize=0[aout]')
    target = OUT / f'{GUIDE}-guide.mp4'
    subprocess.run(['ffmpeg', '-y', *inputs, '-filter_complex', ';'.join(filters), '-map', '0:v', '-map', '[aout]',
                    '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '25',
                    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(target)], check=True)
    srt = []
    for n, mark in enumerate(marks, start=1):
        start = mark['at'] + 0.3
        srt.append(f"{n}\n{ts(start)} --> {ts(start + durations[mark['id']])}\n{steps[mark['id']]['say']}\n")
    (OUT / f'{GUIDE}-guide.srt').write_text('\n'.join(srt), encoding='utf-8')
    print(target, target.stat().st_size)
    return 0


if __name__ == '__main__':
    sys.exit(main())
