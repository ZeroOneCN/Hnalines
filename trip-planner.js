/**
 * 行程规划 - 前端逻辑
 * 数据源：hainan_airlines_data.json（与主站一致，直飞匹配 + 单中转方案推荐）
 * 说明：本模块已并入 index.html 的「行程规划」标签页；整体包裹在 IIFE 内，
 *      避免与 app.js 的同名顶层变量（DATA_URL、selectedProduct、sortPinyin 等）冲突。
 */
(function () {

const DATA_URL = 'hainan_airlines_data.json';
const DRAFT_KEY = 'hna_trip_draft_v1';    // localStorage 行程草稿键
const SEASON_START = '2026-10-25';        // 航季开始日期（日期选择下限）
const SEASON_END = '2027-03-27';          // 航季结束日期（日期选择上限）
const SEGMENT_LIMIT = 3;                  // 海航随心飞单次行程可兑换航段上限（超出仅提醒）
const MAX_TRANSITS = 6;                   // 单段最多展示的中转方案数
const MAX_LEG_ROWS = 5;                   // 中转每程最多展示的航班行数
const WEEK_FULL = ['日', '一', '二', '三', '四', '五', '六'];

let allFlights = [];          // 全部航线
let cityOptions = [];         // 全部城市（拼音序）
let cityProvince = {};        // 城市 → 省份映射（用于同区域机场推荐）
let segments = [];            // 行程段：[{ from, to, date }]
let selectedProduct = 'all';  // 产品筛选 all / 666 / 2666

let inited = false;   // 是否已初始化（标签页首次打开时懒加载，避免与主站重复拉取数据）

/**
 * 模块初始化（懒加载，仅执行一次）
 * 参数：无
 * 返回值：无
 */
function initOnce() {
    if (inited) return;
    inited = true;
    bindGlobalEvents();
    loadDraft();
    loadData();
}

// 标签页点击时初始化；若加载时已停留在本标签页（如 #planner 直达），立即初始化
document.addEventListener('DOMContentLoaded', function () {
    const tabBtn = document.getElementById('tab-planner');
    if (!tabBtn) return;
    tabBtn.addEventListener('click', initOnce);
    if (tabBtn.classList.contains('active')) initOnce();
});

/**
 * 绑定顶部按钮、段列表事件委托、结果区替代机场点击
 * 参数：无
 * 返回值：无
 */
function bindGlobalEvents() {
    document.getElementById('btn-add').addEventListener('click', addSegment);
    document.getElementById('btn-close-loop').addEventListener('click', closeLoop);
    document.getElementById('btn-clear').addEventListener('click', clearAll);

    document.getElementById('planner-product-group').addEventListener('click', function (e) {
        const btn = e.target.closest('button[data-product]');
        if (btn) setProduct(btn.dataset.product);
    });

    const list = document.getElementById('seg-list');

    // 城市搜索框：聚焦展开、输入过滤、键盘上下选择
    list.addEventListener('focusin', function (e) {
        if (e.target.classList.contains('cbx-input')) cbxOpen(e.target);
    });
    list.addEventListener('input', function (e) {
        if (e.target.classList.contains('cbx-input')) {
            cbxRenderMenu(e.target, e.target.value);
        } else if (e.target.classList.contains('seg-date')) {
            // 输入过程中不做任何 DOM 操作，避免打断原生日期录入
        }
    });
    list.addEventListener('keydown', function (e) {
        if (e.target.classList.contains('cbx-input')) cbxKeydown(e, e.target);
    });
    // 在 mousedown 阶段完成城市选择：既避免输入框失焦关闭菜单，又保证鼠标点击可靠生效
    list.addEventListener('mousedown', function (e) {
        const item = e.target.closest('.cbx-item');
        if (!item) return;
        e.preventDefault();
        const input = item.closest('.cbx').querySelector('.cbx-input');
        cbxSelect(input, item.dataset.city);
    });
    list.addEventListener('click', function (e) {
        const del = e.target.closest('.btn-del');
        if (del) {
            segments.splice(Number(del.closest('.seg-card').dataset.index), 1);
            saveDraft();
            renderAll();
        }
    });
    // 城市/日期选择完成：只刷新输出区，不重建输入区（保留焦点与日期控件状态）
    list.addEventListener('change', function (e) {
        const card = e.target.closest('.seg-card');
        if (!card) return;
        const idx = Number(card.dataset.index);
        if (e.target.classList.contains('seg-date')) {
            segments[idx].date = e.target.value;
            // 超出航季日期范围被浏览器拒绝（value 为空）时给出就地提示
            const hint = card.querySelector('.seg-weekday');
            if (!e.target.value && e.target.validity && !e.target.validity.valid) {
                hint.textContent = '超出航季';
                hint.style.color = 'var(--warn)';
            } else {
                hint.style.color = '';
            }
        }
        saveDraft();
        refreshOutputs();
    });
    // 点击搜索框外部时收起菜单并校正输入文本
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.cbx')) document.querySelectorAll('.cbx-menu.open').forEach(function (m) {
            cbxClose(m);
        });
    });

    // 结果区：点击替代机场推荐 chip，替换对应航段的城市
    document.getElementById('result-list').addEventListener('click', function (e) {
        const chip = e.target.closest('.alt-chip');
        if (!chip) return;
        const idx = Number(chip.dataset.altIdx);
        const field = chip.dataset.altField;   // from / to
        segments[idx][field] = chip.dataset.altCity;
        saveDraft();
        renderAll();
    });
}

/**
 * 加载航线数据并初始化城市下拉与省份映射
 * 参数：无
 * 返回值：无
 */
function loadData() {
    fetch(DATA_URL)
        .then(function (r) { return r.json(); })
        .then(function (data) {
            allFlights = data.flights || [];
            const cities = new Set();
            allFlights.forEach(function (f) {
                cities.add(f.departure_city);
                cities.add(f.arrival_city);
                cityProvince[f.departure_city] = f.departure_province;
                cityProvince[f.arrival_city] = f.arrival_province;
            });
            cityOptions = sortPinyin(cities);
            renderAll();
        })
        .catch(function (err) {
            document.getElementById('result-list').innerHTML =
                '<div class="panel empty-tip text-danger">数据加载失败：' + escapeHtml(err.message) + '</div>';
        });
}

/**
 * 设置产品筛选并刷新（段数超限时提示文案与产品相关）
 * 参数：value - all / 666 / 2666
 * 返回值：无
 */
function setProduct(value) {
    selectedProduct = value;
    document.querySelectorAll('#planner-product-group button').forEach(function (btn) {
        const active = btn.dataset.product === value;
        btn.classList.toggle('btn-hna', active);
        btn.classList.toggle('btn-outline-hna', !active);
    });
    saveDraft();
    refreshOutputs();
    updateLimitWarning();
}

/**
 * 新增一个航段；自动继承上一段目的地作为出发地，日期默认顺延一天
 * 参数：无
 * 返回值：无
 */
function addSegment() {
    const last = segments[segments.length - 1];
    let from = '';
    let date = SEASON_START;
    if (last) {
        from = last.to || '';
        if (last.date) date = shiftDate(last.date, 1);
    }
    segments.push({ from: from, to: '', date: date });
    saveDraft();
    renderAll();
}

/**
 * 一键闭环：末段目的地不是首段出发地时，自动补一段回到起点
 * 参数：无
 * 返回值：无
 */
function closeLoop() {
    if (segments.length === 0) return;
    const start = segments[0].from;
    const last = segments[segments.length - 1];
    if (start && last.to && last.to !== start) {
        segments.push({ from: last.to, to: start, date: shiftDate(last.date || SEASON_START, 1) });
        saveDraft();
        renderAll();
    }
}

/**
 * 清空全部行程段（需二次确认）
 * 参数：无
 * 返回值：无
 */
function clearAll() {
    if (segments.length === 0 || confirm('确定清空全部行程段吗？')) {
        segments = [];
        saveDraft();
        renderAll();
    }
}

/**
 * 全量渲染（新增/删除/替换城市等结构性变化时使用，会重建输入区）
 * 参数：无
 * 返回值：无
 */
function renderAll() {
    renderSegments();
    refreshOutputs();
    updateLimitWarning();
}

/**
 * 仅刷新输出区（状态标签、行程链、结果卡），不触碰输入控件
 * 参数：无
 * 返回值：无
 */
function refreshOutputs() {
    updateStatusLabels();
    renderChain();
    renderResults();
}

/* ============ 城市可搜索下拉（combobox） ============ */

/**
 * 展开城市下拉并按当前输入过滤
 * 参数：input - 触发的输入框元素
 * 返回值：无
 */
function cbxOpen(input) {
    cbxRenderMenu(input, input.value);
}

/**
 * 关闭城市下拉并校正输入框文本（未选中城市时恢复原值或清空）
 * 参数：menuOrInput - 菜单元素或输入框元素
 * 返回值：无
 */
function cbxClose(menuOrInput) {
    const wrap = menuOrInput.closest('.cbx');
    if (!wrap) return;
    const menu = wrap.querySelector('.cbx-menu');
    const input = wrap.querySelector('.cbx-input');
    menu.classList.remove('open');
    const idx = Number(wrap.dataset.index);
    const field = wrap.dataset.field;
    const val = segments[idx] ? segments[idx][field] : '';
    input.value = val || '';
}

/**
 * 按关键字渲染城市下拉菜单（城市名包含匹配）
 * 参数：input - 输入框；keyword - 搜索关键字
 * 返回值：无
 */
function cbxRenderMenu(input, keyword) {
    const wrap = input.closest('.cbx');
    const menu = wrap.querySelector('.cbx-menu');
    const kw = keyword.trim();
    const list = kw
        ? cityOptions.filter(function (c) { return c.indexOf(kw) !== -1; })
        : cityOptions;
    if (list.length === 0) {
        menu.innerHTML = '<div class="cbx-empty">未找到匹配城市</div>';
    } else {
        menu.innerHTML = list.map(function (c, i) {
            return '<div class="cbx-item' + (i === 0 ? ' active' : '') + '" data-city="' +
                escapeAttr(c) + '">' + escapeHtml(c) + '</div>';
        }).join('');
    }
    menu.classList.add('open');
}

/**
 * 城市下拉键盘操作：上下移动、回车选中、Esc 关闭
 * 参数：e - 键盘事件；input - 输入框
 * 返回值：无
 */
function cbxKeydown(e, input) {
    const menu = input.closest('.cbx').querySelector('.cbx-menu');
    const items = menu.querySelectorAll('.cbx-item');
    const active = menu.querySelector('.cbx-item.active');
    const idx = active ? Array.prototype.indexOf.call(items, active) : -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (items.length === 0) return;
        e.preventDefault();
        const next = e.key === 'ArrowDown'
            ? (idx + 1 + items.length) % items.length
            : (idx - 1 + items.length) % items.length;
        if (active) active.classList.remove('active');
        items[next].classList.add('active');
        items[next].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
        if (active) {
            e.preventDefault();
            cbxSelect(input, active.dataset.city);
        } else if (items.length === 1) {
            e.preventDefault();
            cbxSelect(input, items[0].dataset.city);
        }
    } else if (e.key === 'Escape') {
        cbxClose(menu);
    }
}

/**
 * 选中一个城市：写入行程数据并局部刷新，不重建输入区
 * 参数：input - 输入框；city - 选中的城市名
 * 返回值：无
 */
function cbxSelect(input, city) {
    const wrap = input.closest('.cbx');
    const idx = Number(wrap.dataset.index);
    const field = wrap.dataset.field;
    input.value = city;
    wrap.querySelector('.cbx-menu').classList.remove('open');
    input.blur();
    segments[idx][field] = city;
    saveDraft();
    refreshOutputs();
    updateLimitWarning();
}

/**
 * 生成单个城市搜索框 HTML
 * 参数：index - 段序号；field - from / to；value - 当前城市
 * 返回值：String combobox HTML
 */
function cityCombobox(index, field, value) {
    return '<div class="cbx" data-index="' + index + '" data-field="' + field + '">' +
        '<input type="text" class="cbx-input form-control form-control-sm" placeholder="输入城市搜索" ' +
        'autocomplete="off" value="' + escapeAttr(value || '') + '">' +
        '<div class="cbx-menu"></div></div>';
}

/* ============ 左侧航段编辑区 ============ */

/**
 * 渲染航段编辑卡片列表（仅在结构性变化时重建）
 * 参数：无
 * 返回值：无
 */
function renderSegments() {
    const list = document.getElementById('seg-list');
    if (segments.length === 0) {
        list.innerHTML = '<div class="text-muted small py-2">还没有航段，点击下方"添加航段"开始规划</div>';
        return;
    }
    list.innerHTML = segments.map(function (seg, i) {
        const status = segmentStatus(seg);
        const cls = status.kind === 'ok' ? 'seg-ok' : (seg.from && seg.to ? 'seg-bad' : '');
        return '<div class="seg-card ' + cls + '" data-index="' + i + '">' +
            '<div class="seg-head">' +
                '<span class="seg-no">第' + (i + 1) + '段</span>' +
                '<span class="seg-status ' + (status.kind === 'ok' ? 'ok' : 'bad') + '">' + escapeHtml(status.text) + '</span>' +
                '<button class="btn btn-sm btn-link text-muted p-0 ms-auto btn-del" title="删除该段"><i class="bi bi-x-lg"></i></button>' +
            '</div>' +
            '<div class="seg-body">' +
                cityCombobox(i, 'from', seg.from) +
                '<i class="bi bi-arrow-right seg-arrow"></i>' +
                cityCombobox(i, 'to', seg.to) +
                '<input type="date" class="seg-date form-control form-control-sm" value="' + escapeAttr(seg.date || '') +
                    '" min="' + SEASON_START + '" max="' + SEASON_END + '">' +
                '<span class="small text-muted seg-weekday">' + (seg.date ? '周' + weekdayName(seg.date) : '') + '</span>' +
            '</div>' +
        '</div>';
    }).join('');
}

/**
 * 局部更新各段卡片的状态文字、边框色与星期显示（不重建输入控件）
 * 参数：无
 * 返回值：无
 */
function updateStatusLabels() {
    segments.forEach(function (seg, i) {
        const card = document.querySelector('.seg-card[data-index="' + i + '"]');
        if (!card) return;
        const st = segmentStatus(seg);
        const label = card.querySelector('.seg-status');
        label.textContent = st.text;
        label.className = 'seg-status ' + (st.kind === 'ok' ? 'ok' : 'bad');
        card.classList.toggle('seg-ok', st.kind === 'ok');
        card.classList.toggle('seg-bad', seg.from && seg.to && st.kind !== 'ok');
        const wd = card.querySelector('.seg-weekday');
        if (wd) {
            const dateInput = card.querySelector('.seg-date');
            const rejected = dateInput && !dateInput.value && dateInput.validity && !dateInput.validity.valid;
            wd.textContent = rejected ? '超出航季' : (seg.date ? '周' + weekdayName(seg.date) : '');
            wd.style.color = rejected ? 'var(--warn)' : '';
        }
    });
}

/**
 * 更新"超过3段"非阻断提醒
 * 参数：无
 * 返回值：无
 */
function updateLimitWarning() {
    const box = document.getElementById('limit-warning');
    const over = segments.length - SEGMENT_LIMIT;
    if (over > 0) {
        const prodText = selectedProduct === 'all' ? '随心飞产品' : selectedProduct + ' 产品';
        document.getElementById('limit-warning-text').textContent =
            '海航' + prodText + '单次行程最多可兑换 ' + SEGMENT_LIMIT + ' 个航段，当前已添加 ' +
            segments.length + ' 段（超出 ' + over + ' 段）；超出航段可能需要自行购票，规划与查询可继续。';
        box.classList.add('show');
    } else {
        box.classList.remove('show');
    }
}

/* ============ 行程链与结果 ============ */

/**
 * 渲染右上行程链条（城市 → 城市，附每段可飞标记）
 * 参数：无
 * 返回值：无
 */
function renderChain() {
    const box = document.getElementById('chain-view');
    if (segments.length === 0) {
        box.innerHTML = '<span class="text-muted small">尚未添加航段</span>';
        return;
    }
    const parts = [];
    const first = segments[0].from;
    if (first) parts.push('<span class="chain-city">' + escapeHtml(first) + '</span>');
    segments.forEach(function (seg) {
        const st = segmentStatus(seg);
        const mark = seg.from && seg.to
            ? '<span class="chain-mark ' + (st.kind === 'ok' ? 'ok' : 'bad') + '">' +
              (st.kind === 'ok' ? '<i class="bi bi-check-circle-fill"></i>' : '<i class="bi bi-x-circle-fill"></i>') + '</span>'
            : '';
        parts.push('<i class="bi bi-arrow-right text-muted small"></i>' + mark +
            '<span class="chain-city">' + escapeHtml(seg.to || '？') + '</span>');
    });
    box.innerHTML = parts.join('');
}

/**
 * 渲染右下每段的结果卡片
 * 参数：无
 * 返回值：无
 */
function renderResults() {
    const wrap = document.getElementById('result-list');
    if (segments.length === 0) {
        wrap.innerHTML = '<div class="panel empty-tip"><i class="bi bi-airplane-engines" style="font-size:2rem;"></i>' +
            '<div class="mt-2">添加航段后，这里会显示每段的可用航班</div></div>';
        return;
    }
    wrap.innerHTML = segments.map(function (seg, i) {
        if (!seg.from || !seg.to) {
            return resultShell(i, seg, '<div class="text-muted small px-2 py-1">请先选择出发和到达城市</div>');
        }
        const matches = findFlights(seg.from, seg.to);
        if (matches.length === 0) {
            return resultShell(i, seg, buildNoDirectHtml(seg, i));
        }
        const dayCode = seg.date ? weekdayCode(seg.date) : null;
        const rows = matches.map(function (f) {
            const flyToday = dayCode && f.schedule.indexOf(dayCode) !== -1;
            const inRange = !seg.date || inDateRange(seg.date, f.date_range);
            const rowCls = flyToday && inRange ? 'row-ok' : (inRange ? '' : 'row-outrange');
            const badge = !seg.date ? '<span class="text-muted small">未选日期</span>'
                : (flyToday && inRange ? '<span class="day-badge ok">当天可飞</span>'
                    : (inRange ? '<span class="day-badge bad">当天无班</span>'
                        : '<span class="day-badge bad">超出适用期</span>'));
            const rangeTip = inRange ? '' : ' title="所选日期不在该航班适用日期段内"';
            return '<tr class="' + rowCls + '"' + rangeTip + '>' +
                '<td class="fw-semibold">' + escapeHtml(f.flight_number) + '</td>' +
                '<td>' + escapeHtml(f.departure_time) + '</td>' +
                '<td>' + escapeHtml(scheduleText(f.schedule)) + '</td>' +
                '<td>' + badge + '</td>' +
                '<td>' + escapeHtml(f.date_range || '-') + '</td>' +
                '<td>' + escapeHtml(f.product) + '</td>' +
                '</tr>';
        }).join('');
        const body = '<div class="table-responsive"><table class="table table-sm table-hover table-planner">' +
            '<thead><tr><th>航班号</th><th>出发时刻</th><th>班期</th><th>所选日期</th><th>适用日期段</th><th>产品</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table></div>';
        return resultShell(i, seg, body);
    }).join('');
}

/**
 * 无直飞时的建议内容：同区域替代机场 + 单中转方案
 * 参数：seg - 段数据；i - 段序号（chip 替换时定位用）
 * 返回值：String HTML
 */
function buildNoDirectHtml(seg, i) {
    let html = '<div class="px-2 pt-1 pb-2 text-danger small"><i class="bi bi-exclamation-triangle"></i> ' +
        '未查询到 ' + escapeHtml(seg.from) + ' → ' + escapeHtml(seg.to) + ' 的直飞适用航班</div>';

    // 1) 同区域替代机场：目的省可直飞城市 / 出发省可直飞到目的地的城市
    const altTo = sameProvinceCities(seg.to)
        .filter(function (c) { return findFlights(seg.from, c).length > 0; })
        .sort(altCitySorter(seg.to));
    const altFrom = sameProvinceCities(seg.from)
        .filter(function (c) { return findFlights(c, seg.to).length > 0; })
        .sort(altCitySorter(seg.from));

    if (altTo.length || altFrom.length) {
        html += '<div class="px-2 pb-2"><div class="small text-muted mb-1"><i class="bi bi-geo-alt"></i> 同区域可直飞机场（点击替换）：</div><div class="d-flex flex-wrap gap-1">';
        altTo.forEach(function (c) {
            html += '<button type="button" class="alt-chip" data-alt-idx="' + i + '" data-alt-field="to" data-alt-city="' +
                escapeAttr(c) + '">改飞 ' + escapeHtml(c) + ' · ' + findFlights(seg.from, c).length + '班</button>';
        });
        altFrom.forEach(function (c) {
            html += '<button type="button" class="alt-chip" data-alt-idx="' + i + '" data-alt-field="from" data-alt-city="' +
                escapeAttr(c) + '">从 ' + escapeHtml(c) + ' 出发 · ' + findFlights(c, seg.to).length + '班</button>';
        });
        html += '</div></div>';
    }

    // 2) 单中转方案：A→C 且 C→B 均有航班
    const transits = findTransits(seg);
    if (transits.length > 0) {
        html += '<div class="px-2 pb-1"><div class="small text-muted mb-1"><i class="bi bi-signpost-2"></i> 中转方案（共 ' +
            transits.length + ' 个可选中转城市' + (transits.length >= MAX_TRANSITS ? '，仅展示最优 ' + MAX_TRANSITS : '') + '）：</div>';
        transits.slice(0, MAX_TRANSITS).forEach(function (t) {
            html += renderTransitCard(t, seg.date);
        });
        html += '</div>';
    } else if (altTo.length === 0 && altFrom.length === 0) {
        html += '<div class="px-2 pb-2 text-muted small">当前航季数据中也未找到可行的中转航线，建议更换出发或到达城市。</div>';
    }
    return html;
}

/**
 * 生成单个中转方案卡片（含两程航班明细与日期可行性）
 * 参数：t - { city, leg1:[航班], leg2:[航班], level }；date - 所选日期
 * 返回值：String HTML
 */
function renderTransitCard(t, date) {
    const levelText = t.level === 2 ? '当天可中转' : (t.level === 1 ? '次日抵达可行' : '班期需自行核对');
    const leg2Date = t.level === 1 ? shiftDate(date, 1) : date;
    const badge = '<span class="t-badge lv' + t.level + '">' + levelText + '</span>';
    const head = '<div class="d-flex align-items-center gap-1 flex-wrap mb-1">' +
        '<strong>' + escapeHtml(t.leg1[0].departure_city) + '</strong>' +
        '<i class="bi bi-arrow-right small text-muted"></i>' +
        '<strong class="text-hna">' + escapeHtml(t.city) + '</strong>' +
        '<i class="bi bi-arrow-right small text-muted"></i>' +
        '<strong>' + escapeHtml(t.leg2[0].arrival_city) + '</strong>' + badge + '</div>';

    const legRows = function (flights, legDate) {
        const code = legDate ? weekdayCode(legDate) : null;
        return flights.slice(0, MAX_LEG_ROWS).map(function (f) {
            const ok = code && f.schedule.indexOf(code) !== -1 && (!legDate || inDateRange(legDate, f.date_range));
            return '<tr class="' + (ok ? 'row-ok' : '') + '"><td>' + escapeHtml(f.flight_number) + '</td>' +
                '<td>' + escapeHtml(f.departure_time) + '</td><td>' + escapeHtml(scheduleText(f.schedule)) + '</td>' +
                '<td class="small text-muted">' + escapeHtml(f.product) + '</td></tr>';
        }).join('') + (flights.length > MAX_LEG_ROWS ? '<tr><td colspan="4" class="text-muted small">另有 ' +
            (flights.length - MAX_LEG_ROWS) + ' 班未展开</td></tr>' : '');
    };

    return '<div class="transit-card t-level' + t.level + '">' + head +
        '<table class="table table-borderless mini-table mb-0"><tbody>' +
        '<tr><td class="leg-title align-top" style="width:44px">第一程' +
            (date ? '<br><span class="text-muted">' + date.slice(5) + '</span>' : '') + '</td>' +
            '<td><table class="table table-sm table-borderless mini-table"><thead><tr>' +
            '<th>航班号</th><th>时刻</th><th>班期</th><th>产品</th></tr></thead><tbody>' +
            legRows(t.leg1, date) + '</tbody></table></td></tr>' +
        '<tr><td class="leg-title align-top">第二程' +
            (date && t.level === 1 ? '<br><span class="text-muted">' + leg2Date.slice(5) + '</span>' :
                (date ? '<br><span class="text-muted">' + leg2Date.slice(5) + '</span>' : '')) + '</td>' +
            '<td><table class="table table-sm table-borderless mini-table"><thead><tr>' +
            '<th>航班号</th><th>时刻</th><th>班期</th><th>产品</th></tr></thead><tbody>' +
            legRows(t.leg2, leg2Date) + '</tbody></table></td></tr>' +
        '</tbody></table></div>';
}

/**
 * 计算单中转方案集合并按日期可行性排序
 * 参数：seg - 段数据 { from, to, date }
 * 返回值：Array 中转方案 [{ city, leg1, leg2, level }]，level 2=当天 1=次日 0=班期待核对
 */
function findTransits(seg) {
    const outgoing = {};   // 中转城市 C → from→C 航班列表
    const incoming = {};   // 中转城市 C → C→to 航班列表
    allFlights.forEach(function (f) {
        const productOk = selectedProduct === 'all' ||
            (f.product || '').split('/').indexOf(selectedProduct) !== -1;
        if (!productOk) return;
        if (f.departure_city === seg.from && f.arrival_city !== seg.to) {
            (outgoing[f.arrival_city] = outgoing[f.arrival_city] || []).push(f);
        }
        if (f.arrival_city === seg.to && f.departure_city !== seg.from) {
            (incoming[f.departure_city] = incoming[f.departure_city] || []).push(f);
        }
    });
    const code = seg.date ? weekdayCode(seg.date) : null;
    const nextCode = seg.date ? weekdayCode(shiftDate(seg.date, 1)) : null;

    const flyable = function (flights, dayCode, dateStr) {
        return flights.filter(function (f) {
            return dayCode && f.schedule.indexOf(dayCode) !== -1 &&
                (!dateStr || inDateRange(dateStr, f.date_range));
        });
    };

    return Object.keys(outgoing).filter(function (c) { return incoming[c]; }).map(function (c) {
        const leg1 = outgoing[c].slice().sort(byTime);
        const leg2 = incoming[c].slice().sort(byTime);
        let level = 0;
        if (seg.date) {
            const a1 = flyable(leg1, code, seg.date);
            const b0 = flyable(leg2, code, seg.date);
            const b1 = flyable(leg2, nextCode, shiftDate(seg.date, 1));
            if (a1.length > 0 && b0.length > 0) level = 2;
            else if (a1.length > 0 && b1.length > 0) level = 1;
        }
        return { city: c, leg1: leg1, leg2: leg2, level: level };
    }).sort(function (a, b) {
        if (b.level !== a.level) return b.level - a.level;
        return (b.leg1.length + b.leg2.length) - (a.leg1.length + a.leg2.length);
    });
}

/**
 * 航班按出发时刻排序的比较函数
 * 参数：a、b - 航班记录
 * 返回值：Number
 */
function byTime(a, b) {
    return (a.departure_time || '').localeCompare(b.departure_time || '');
}

/**
 * 查询与指定城市同省份的其他城市（同区域机场推荐依据）
 * 参数：city - 城市名
 * 返回值：Array 同省份其他城市名数组
 */
function sameProvinceCities(city) {
    const province = cityProvince[city];
    if (!province) return [];
    return Object.keys(cityProvince).filter(function (c) {
        return c !== city && cityProvince[c] === province;
    });
}

/**
 * 替代机场排序：同城多机场优先（如首都/大兴、浦东/虹桥共享前缀），再按名称
 * 参数：anchor - 当前城市名
 * 返回值：Function 数组排序比较函数
 */
function altCitySorter(anchor) {
    const prefix = anchor.slice(0, 2);
    return function (a, b) {
        const sa = a.indexOf(prefix) === 0 ? 0 : 1;
        const sb = b.indexOf(prefix) === 0 ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return a.localeCompare(b, 'zh-Hans-CN');
    };
}

/**
 * 生成单段结果卡片外壳（含标题与当天状态摘要）
 * 参数：i - 段序号；seg - 段数据；bodyHtml - 卡片正文 HTML
 * 返回值：String 卡片 HTML
 */
function resultShell(i, seg, bodyHtml) {
    const st = segmentStatus(seg);
    const border = st.kind === 'ok' ? 'border-success' : (seg.from && seg.to ? 'border-danger' : '');
    const dateText = seg.date ? seg.date + '（周' + weekdayName(seg.date) + '）' : '未选日期';
    return '<div class="panel result-card border ' + border + '">' +
        '<div class="d-flex align-items-center mb-2 flex-wrap gap-2">' +
            '<span class="seg-no">第' + (i + 1) + '段</span>' +
            '<strong>' + escapeHtml(seg.from || '？') + ' <i class="bi bi-arrow-right small"></i> ' + escapeHtml(seg.to || '？') + '</strong>' +
            '<span class="text-muted small">' + dateText + '</span>' +
            '<span class="ms-auto small fw-semibold ' + (st.kind === 'ok' ? 'text-success' : 'text-danger') + '">' + escapeHtml(st.text) + '</span>' +
        '</div>' + bodyHtml + '</div>';
}

/**
 * 计算单个航段的状态摘要（用于段卡片与链条标记）
 * 参数：seg - 段数据 { from, to, date }
 * 返回值：Object { kind: 'ok'|'bad'|'none', text: 状态文案 }
 */
function segmentStatus(seg) {
    if (!seg.from || !seg.to) return { kind: 'none', text: '待选择' };
    const matches = findFlights(seg.from, seg.to);
    if (matches.length === 0) {
        const transits = findTransits(seg).length;
        return { kind: 'bad', text: transits > 0 ? '无直飞，' + transits + ' 个中转方案' : '无直飞' };
    }
    if (!seg.date) return { kind: 'bad', text: matches.length + ' 个航班，待选日期' };
    const code = weekdayCode(seg.date);
    const flyable = matches.filter(function (f) {
        return f.schedule.indexOf(code) !== -1 && inDateRange(seg.date, f.date_range);
    });
    if (flyable.length > 0) return { kind: 'ok', text: '当天 ' + flyable.length + ' 班可选' };
    return { kind: 'bad', text: '当天无适用航班' };
}

/**
 * 按城市对与当前产品筛选查找直飞航班，结果按出发时刻排序
 * 参数：from - 出发城市；to - 到达城市
 * 返回值：Array 航班记录数组
 */
function findFlights(from, to) {
    return allFlights.filter(function (f) {
        if (f.departure_city !== from || f.arrival_city !== to) return false;
        if (selectedProduct === 'all') return true;
        return (f.product || '').split('/').indexOf(selectedProduct) !== -1;
    }).slice().sort(byTime);
}

/* ============ 日期工具 ============ */

/**
 * 判断日期是否在航班适用日期段内（段格式 MM.DD-MM.DD，航季跨年）
 * 参数：dateStr - yyyy-MM-dd；range - 如 '10.26-03.22'
 * 返回值：Boolean 是否在适用期内
 */
function inDateRange(dateStr, range) {
    if (!range || range.indexOf('-') === -1) return true;
    const d = parseYmd(dateStr);
    if (!d) return true;
    const parts = range.split('-');
    const s = parseMd(parts[0]);
    const e = parseMd(parts[1]);
    if (!s || !e) return true;
    // 结束月小于起始月视为跨年（10月-次年3月航季）：
    // 日期月>=起始月说明落在航季上半年（10-12月），否则落在下半年（次年1-3月）
    const crossYear = e.m < s.m;
    const startY = crossYear ? (d.m >= s.m ? d.y : d.y - 1) : d.y;
    const endY = crossYear ? startY + 1 : d.y;
    const startNum = startY * 10000 + s.m * 100 + s.d;
    const endNum = endY * 10000 + e.m * 100 + e.d;
    const curNum = d.y * 10000 + d.m * 100 + d.d;
    return curNum >= startNum && curNum <= endNum;
}

/**
 * 解析 yyyy-MM-dd 日期
 * 参数：s - 日期字符串
 * 返回值：Object { y, m, d }，无效返回 null
 */
function parseYmd(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

/**
 * 解析 MM.DD 月日
 * 参数：s - 月日字符串
 * 返回值：Object { m, d }，无效返回 null
 */
function parseMd(s) {
    const m = /^(\d{1,2})\.(\d{1,2})$/.exec(String(s).trim());
    return m ? { m: Number(m[1]), d: Number(m[2]) } : null;
}

/**
 * 将日期字符串顺延指定天数
 * 参数：dateStr - yyyy-MM-dd；days - 顺延天数
 * 返回值：String 新日期 yyyy-MM-dd
 */
function shiftDate(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}

/**
 * 获取日期对应的民航班期代码（周一=1 … 周日=7）
 * 参数：dateStr - yyyy-MM-dd
 * 返回值：String 班期代码
 */
function weekdayCode(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const jsDay = d.getDay();   // 0=周日 … 6=周六
    return jsDay === 0 ? '7' : String(jsDay);
}

/**
 * 获取日期对应的中文星期名
 * 参数：dateStr - yyyy-MM-dd
 * 返回值：String 一/二/…/日
 */
function weekdayName(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return WEEK_FULL[d.getDay()];
}

/**
 * 将班期代码转换为易读文本（246 → 二/四/六，1234567 → 每日）
 * 参数：code - 班期数字字符串
 * 返回值：String 展示文本
 */
function scheduleText(code) {
    if (code === '1234567') return '每日';
    const map = { '1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六', '7': '日' };
    return String(code).split('').map(function (x) { return map[x] || x; }).join('/');
}

/**
 * 按中文拼音排序
 * 参数：items - Set 或数组
 * 返回值：Array 排序后的数组
 */
function sortPinyin(items) {
    try {
        return Array.from(items).sort(function (a, b) {
            return a.localeCompare(b, 'zh-Hans-CN', { sensitivity: 'accent' });
        });
    } catch (e) {
        return Array.from(items).sort();
    }
}

/* ============ 草稿与转义 ============ */

/**
 * 保存行程草稿到 localStorage（段与产品选择）
 * 参数：无
 * 返回值：无
 */
function saveDraft() {
    try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ segments: segments, product: selectedProduct }));
    } catch (e) { /* 存储不可用时忽略 */ }
}

/**
 * 从 localStorage 恢复行程草稿并同步产品按钮状态
 * 参数：无
 * 返回值：无
 */
function loadDraft() {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (raw) {
            const draft = JSON.parse(raw);
            segments = Array.isArray(draft.segments) ? draft.segments : [];
            selectedProduct = draft.product || 'all';
        }
    } catch (e) {
        segments = [];
    }
    if (selectedProduct !== 'all') {
        document.querySelectorAll('#planner-product-group button').forEach(function (btn) {
            const active = btn.dataset.product === selectedProduct;
            btn.classList.toggle('btn-hna', active);
            btn.classList.toggle('btn-outline-hna', !active);
        });
    }
}

/**
 * HTML 文本转义，防止 XSS
 * 参数：text - 原始字符串
 * 返回值：String 转义后的字符串
 */
function escapeHtml(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * 属性值转义
 * 参数：text - 原始字符串
 * 返回值：String 转义后的字符串
 */
function escapeAttr(text) {
    return escapeHtml(text);
}

})();
