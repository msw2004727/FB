// scripts/timeEffects.js
// 時辰動態 Canvas 特效

let _canvas = null;
let _ctx = null;
let _animId = null;
let _currentEffect = null;
let _particles = [];
let _paused = false;

export function init(canvasEl) {
    _canvas = canvasEl;
    _ctx = canvasEl.getContext('2d');
    _resize();
    window.addEventListener('resize', _resize);
}

function _resize() {
    if (!_canvas) return;
    _canvas.width = _canvas.parentElement.clientWidth;
    _canvas.height = _canvas.parentElement.clientHeight;
}

export function pause() { _paused = true; }
export function resume() { _paused = false; }

export function switchEffect(timeOfDay) {
    cancelAnimationFrame(_animId);
    _particles = [];
    if (!_canvas || !_ctx) return;
    _resize();
    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);

    // 映射各劇本時辰到通用特效
    const effectMap = {
        '清晨': 'dawn', '早自習': 'dawn',
        '上午': 'morning', '上午課': 'morning',
        '中午': 'noon', '午休': 'noon',
        '下午': 'afternoon', '下午課': 'afternoon',
        '黃昏': 'dusk', '放學': 'dusk',
        '夜晚': 'night', '晚自習': 'night',
        '深夜': 'midnight', '宵禁後': 'midnight',
        // 機甲
        '黎明戒備': 'dawn', '第一班哨': 'morning', '正午輪替': 'noon',
        '第二班哨': 'afternoon', '黃昏警戒': 'dusk', '夜間值勤': 'night', '深夜靜默': 'midnight',
        // 英雄
        '晨光時段': 'dawn', '上午巡邏': 'morning', '正午休整': 'noon',
        '下午任務': 'afternoon', '黃昏警備': 'dusk', '夜間值守': 'night', '深夜潛行': 'midnight',
        // 現代
        '早晨通勤': 'dawn', '上午工時': 'morning', '午餐時間': 'noon',
        '下午工時': 'afternoon', '傍晚下班': 'dusk', '夜間自由': 'night', '深夜時分': 'midnight',
        // 動物
        '晨露': 'dawn', '日出覓食': 'morning', '正午休憩': 'noon',
        '午後巡域': 'afternoon', '黃昏歸巢': 'dusk', '月夜': 'night', '子夜': 'midnight',
    };
    const effect = effectMap[timeOfDay];
    _currentEffect = effect;
    switch (effect) {
        case 'dawn': _initBirds(); break;
        case 'morning': _initDust(); break;
        case 'noon': _initHeatWave(); break;
        case 'afternoon': _initLeaves(); break;
        case 'dusk': _initSunsetGlow(); break;
        case 'night': _initFireflies(); break;
        case 'midnight': _initShootingStar(); break;
        default: return;
    }
    _loop();
}

function _loop() {
    if (!_ctx || !_canvas) return;
    if (!_paused) {
        _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
        switch (_currentEffect) {
            case 'dawn': _drawBirds(); break;
            case 'morning': _drawDust(); break;
            case 'noon': _drawHeatWave(); break;
            case 'afternoon': _drawLeaves(); break;
            case 'dusk': _drawSunsetGlow(); break;
            case 'night': _drawFireflies(); break;
            case 'midnight': _drawShootingStar(); break;
        }
    }
    _animId = requestAnimationFrame(_loop);
}

// === 清晨：鳥群飛過 ===
function _initBirds() {
    _particles = [];
    _spawnBirdGroup();
}
function _spawnBirdGroup() {
    const y = 30 + Math.random() * (_canvas.height * 0.25);
    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
        _particles.push({
            x: -30 - i * 25 - Math.random() * 15,
            y: y + (Math.random() - 0.5) * 20,
            vx: 0.6 + Math.random() * 0.3,
            wing: 0,
            wingSpeed: 0.04 + Math.random() * 0.02,
        });
    }
}
function _drawBirds() {
    _ctx.strokeStyle = 'rgba(80, 60, 40, 0.2)';
    _ctx.lineWidth = 1.5;
    _ctx.lineCap = 'round';
    let allGone = true;
    for (const b of _particles) {
        b.x += b.vx;
        b.wing += b.wingSpeed;
        if (b.x < _canvas.width + 50) allGone = false;
        const wingY = Math.sin(b.wing) * 5;
        _ctx.beginPath();
        _ctx.moveTo(b.x - 8, b.y + wingY);
        _ctx.quadraticCurveTo(b.x, b.y - 2, b.x + 8, b.y + wingY);
        _ctx.stroke();
    }
    if (allGone) {
        _particles = [];
        setTimeout(() => { if (_currentEffect === 'dawn') _spawnBirdGroup(); }, 6000 + Math.random() * 8000);
    }
}

// === 上午：浮塵光斑 ===
function _initDust() {
    _particles = [];
    for (let i = 0; i < 15; i++) {
        _particles.push({
            x: Math.random() * _canvas.width,
            y: Math.random() * _canvas.height,
            r: 1 + Math.random() * 2,
            vx: (Math.random() - 0.5) * 0.15,
            vy: -0.1 - Math.random() * 0.1,
            alpha: 0.1 + Math.random() * 0.15,
        });
    }
}
function _drawDust() {
    for (const p of _particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -5) { p.y = _canvas.height + 5; p.x = Math.random() * _canvas.width; }
        _ctx.beginPath();
        _ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        _ctx.fillStyle = `rgba(210, 180, 120, ${p.alpha})`;
        _ctx.fill();
    }
}

// === 中午：熱氣光點緩慢上升 ===
function _initHeatWave() {
    _particles = [];
    for (let i = 0; i < 10; i++) {
        _particles.push({
            x: Math.random() * _canvas.width,
            y: _canvas.height * 0.5 + Math.random() * _canvas.height * 0.5,
            r: 1.5 + Math.random() * 2,
            vy: -0.15 - Math.random() * 0.1,
            vx: (Math.random() - 0.5) * 0.1,
            alpha: 0.06 + Math.random() * 0.06,
        });
    }
}
function _drawHeatWave() {
    for (const p of _particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -5) { p.y = _canvas.height + 5; p.x = Math.random() * _canvas.width; }
        _ctx.beginPath();
        _ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        _ctx.fillStyle = `rgba(255, 220, 100, ${p.alpha})`;
        _ctx.fill();
    }
}

// === 下午：落葉飄飛 ===
function _initLeaves() {
    _particles = [];
    for (let i = 0; i < 4; i++) _spawnLeaf();
}
function _spawnLeaf() {
    _particles.push({
        x: Math.random() * _canvas.width,
        y: -15,
        vx: 0.3 + Math.random() * 0.4,
        vy: 0.5 + Math.random() * 0.5,
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.03,
        size: 5 + Math.random() * 4,
        wobble: Math.random() * Math.PI * 2,
    });
}
function _drawLeaves() {
    const colors = ['rgba(160, 120, 50, 0.25)', 'rgba(180, 100, 30, 0.2)', 'rgba(130, 140, 50, 0.2)'];
    for (let i = _particles.length - 1; i >= 0; i--) {
        const p = _particles[i];
        p.wobble += 0.02;
        p.x += p.vx + Math.sin(p.wobble) * 0.5;
        p.y += p.vy;
        p.rot += p.rotSpeed;
        if (p.y > _canvas.height + 20) {
            _particles.splice(i, 1);
            if (_currentEffect === 'afternoon') setTimeout(_spawnLeaf, 2000 + Math.random() * 4000);
            continue;
        }
        _ctx.save();
        _ctx.translate(p.x, p.y);
        _ctx.rotate(p.rot);
        _ctx.beginPath();
        _ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
        _ctx.fillStyle = colors[i % colors.length];
        _ctx.fill();
        _ctx.restore();
    }
}

// === 黃昏：火燒雲光帶 ===
let _glowPhase = 0;
function _initSunsetGlow() { _glowPhase = 0; }
function _drawSunsetGlow() {
    _glowPhase += 0.008;
    const alpha = 0.06 + Math.sin(_glowPhase) * 0.03;
    const grad = _ctx.createLinearGradient(0, 0, 0, 60);
    grad.addColorStop(0, `rgba(255, 120, 50, ${alpha})`);
    grad.addColorStop(1, 'rgba(255, 120, 50, 0)');
    _ctx.fillStyle = grad;
    _ctx.fillRect(0, 0, _canvas.width, 60);
}

// === 夜晚：螢火蟲 ===
function _initFireflies() {
    _particles = [];
    for (let i = 0; i < 7; i++) {
        _particles.push({
            x: Math.random() * _canvas.width,
            y: _canvas.height * 0.3 + Math.random() * _canvas.height * 0.6,
            phase: Math.random() * Math.PI * 2,
            speed: 0.01 + Math.random() * 0.015,
            dx: (Math.random() - 0.5) * 0.3,
            dy: (Math.random() - 0.5) * 0.2,
        });
    }
}
function _drawFireflies() {
    for (const p of _particles) {
        p.phase += p.speed;
        p.x += p.dx;
        p.y += p.dy;
        if (p.x < 0 || p.x > _canvas.width) p.dx *= -1;
        if (p.y < _canvas.height * 0.2 || p.y > _canvas.height * 0.9) p.dy *= -1;
        const alpha = 0.15 + Math.sin(p.phase) * 0.15;
        const r = 2 + Math.sin(p.phase) * 1;
        _ctx.beginPath();
        _ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        _ctx.fillStyle = `rgba(160, 230, 120, ${alpha})`;
        _ctx.fill();
        // glow
        _ctx.beginPath();
        _ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2);
        _ctx.fillStyle = `rgba(160, 230, 120, ${alpha * 0.2})`;
        _ctx.fill();
    }
}

// === 深夜：流星劃過 ===
let _meteorTimer = 0;
let _meteor = null;
function _initShootingStar() {
    _meteor = null;
    _meteorTimer = 0;
    // 星空背景粒子
    _particles = [];
    for (let i = 0; i < 20; i++) {
        _particles.push({
            x: Math.random() * _canvas.width,
            y: Math.random() * _canvas.height * 0.6,
            r: 0.5 + Math.random() * 1,
            phase: Math.random() * Math.PI * 2,
            speed: 0.005 + Math.random() * 0.01,
        });
    }
}
function _drawShootingStar() {
    // 星星閃爍
    for (const s of _particles) {
        s.phase += s.speed;
        const alpha = 0.08 + Math.sin(s.phase) * 0.06;
        _ctx.beginPath();
        _ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        _ctx.fillStyle = `rgba(200, 210, 230, ${alpha})`;
        _ctx.fill();
    }
    // 流星
    _meteorTimer++;
    if (!_meteor && _meteorTimer > 480 + Math.random() * 600) {
        _meteorTimer = 0;
        _meteor = {
            x: _canvas.width * (0.5 + Math.random() * 0.5),
            y: 0,
            vx: -3 - Math.random() * 2,
            vy: 2 + Math.random() * 1.5,
            trail: [],
            life: 60 + Math.floor(Math.random() * 30),
        };
    }
    if (_meteor) {
        _meteor.trail.push({ x: _meteor.x, y: _meteor.y });
        if (_meteor.trail.length > 15) _meteor.trail.shift();
        _meteor.x += _meteor.vx;
        _meteor.y += _meteor.vy;
        _meteor.life--;
        // 尾跡
        for (let i = 0; i < _meteor.trail.length; i++) {
            const t = _meteor.trail[i];
            const alpha = (i / _meteor.trail.length) * 0.25;
            const r = (i / _meteor.trail.length) * 1.5;
            _ctx.beginPath();
            _ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
            _ctx.fillStyle = `rgba(220, 230, 255, ${alpha})`;
            _ctx.fill();
        }
        // 流星頭
        _ctx.beginPath();
        _ctx.arc(_meteor.x, _meteor.y, 2, 0, Math.PI * 2);
        _ctx.fillStyle = 'rgba(240, 245, 255, 0.4)';
        _ctx.fill();
        if (_meteor.life <= 0 || _meteor.x < -20 || _meteor.y > _canvas.height) {
            _meteor = null;
        }
    }
}
