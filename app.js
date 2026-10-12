/**
 * 海航随心飞航线 - 前端逻辑
 * 数据源：hainan_airlines_data.json（2026冬春航季）
 */

const DATA_URL = 'hainan_airlines_data.json';
const NOTICE_URL = 'notice.json';
const NOTICE_READ_KEY = 'hna_notice_read';   // localStorage 已读通知 id
const PAGE_SIZE = 50;
const WEEK_MAP = { '1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六', '7': '日' };

let currentPage = 1;
let totalPages = 0;
let allData = { flights: [], data_version: '未知', total_flights: 0 };
let filteredFlights = [];   // 当前筛选+排序后的完整列表
let sortKey = null;         // null 表示保持数据原始顺序（Excel 已按出港城市 A-Z 排序）
let sortDir = 1;            // 1 升序 / -1 降序
let selectedProduct = 'all';
let statisticsModal = null;
let noticeModal = null;
let currentNotice = null;   // 当前通知对象（null 表示无通知）
let searchTimer = null;

// 页面加载完成后初始化数据与事件
document.addEventListener('DOMContentLoaded', function () {
    statisticsModal = new bootstrap.Modal(document.getElementById('statisticsModal'));
    noticeModal = new bootstrap.Modal(document.getElementById('noticeModal'));
    bindEvents();
    bindNoticeEvents();
    loadData();
    loadNotice();
});

/**
 * 绑定通知弹窗交互（铃铛重看、关闭时标记已读）
 * 参数：无
 * 返回值：无
 */
function bindNoticeEvents() {
    document.getElementById('notice-bell').addEventListener('click', function () {
        if (currentNotice) showNoticeModal(false);
    });
    document.getElementById('notice-ok').addEventListener('click', markNoticeRead);
    document.getElementById('noticeModal').addEventListener('hidden.bs.modal', markNoticeRead);
}

/**
 * 拉取站点通知配置（notice.json），失败时静默跳过
 * 参数：无
 * 返回值：无
 */
function loadNotice() {
    fetch(NOTICE_URL)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (notice) {
            if (notice && notice.enabled !== false && notice.id) {
                currentNotice = notice;
                // 同一版本仅自动弹一次：已读记录保存在 localStorage
                if (getReadNoticeId() !== notice.id) showNoticeModal(true);
            }
            // 无有效通知（未配置、已下线或字段缺失）时同步隐藏铃铛入口
            updateNoticeBell();
        })
        .catch(function () { /* 通知为可选功能，加载失败不影响主流程 */ });
}

/**
 * 渲染并弹出通知弹窗
 * 参数：auto - 是否自动弹出（true 时仅未读弹出；false 为用户主动查看）
 * 返回值：无
 */
function showNoticeModal(auto) {
    if (!currentNotice) return;
    document.getElementById('notice-title').textContent = currentNotice.title || '站点通知';
    document.getElementById('notice-body').textContent = currentNotice.content || '';
    // 落款（发文单位与日期）按正式行文右对齐，未配置时隐藏
    const signEl = document.getElementById('notice-signature');
    if (signEl) {
        signEl.textContent = currentNotice.signature || '';
        signEl.style.display = currentNotice.signature ? '' : 'none';
    }
    document.getElementById('notice-date').textContent = currentNotice.publish_date ? '发布于 ' + currentNotice.publish_date : '';
    noticeModal.show();
}

/**
 * 将当前通知标记为已读（写入 localStorage 并熄灭红点）
 * 参数：无
 * 返回值：无
 */
function markNoticeRead() {
    if (!currentNotice) return;
    try {
        localStorage.setItem(NOTICE_READ_KEY, currentNotice.id);
    } catch (e) { /* 隐私模式等场景下忽略 */ }
    updateNoticeBell();
}

/**
 * 读取已读通知 id
 * 参数：无
 * 返回值：String 已读通知 id；未读过返回 null
 */
function getReadNoticeId() {
    try {
        return localStorage.getItem(NOTICE_READ_KEY);
    } catch (e) {
        return null;
    }
}

/**
 * 更新导航栏铃铛入口：无有效通知时隐藏整个铃铛，有通知时按已读状态控制红点
 * 参数：无
 * 返回值：无
 */
function updateNoticeBell() {
    const bell = document.getElementById('notice-bell');
    const dot = document.getElementById('notice-dot');
    if (!bell || !dot) return;
    if (!currentNotice) {
        bell.style.display = 'none';
        return;
    }
    bell.style.display = '';
    const unread = getReadNoticeId() !== currentNotice.id;
    dot.style.display = unread ? 'block' : 'none';
}

/**
 * 绑定页面交互事件（筛选下拉、搜索防抖、产品按钮、表头排序）
 * 参数：无
 * 返回值：无
 */
function bindEvents() {
    ['province-filter', 'dep-city-filter', 'arr-city-filter'].forEach(function (id) {
        document.getElementById(id).addEventListener('change', function () { loadFlights(1); });
    });

    // 搜索输入实时筛选（200ms 防抖，避免频繁渲染）
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { loadFlights(1); }, 200);
    });
    searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { clearTimeout(searchTimer); loadFlights(1); }
    });

    // 产品筛选按钮（事件委托，兼容动态按钮）
    document.querySelector('.product-chip-group').addEventListener('click', function (e) {
        const btn = e.target.closest('button[data-product]');
        if (btn) setProductSelection(btn.dataset.product);
    });

    // 表头排序
    document.querySelectorAll('#flights-table thead th[data-sort]').forEach(function (th) {
        th.addEventListener('click', function () { setSortKey(th.dataset.sort); });
    });
}

/**
 * 加载航线数据并初始化筛选器与统计卡片
 * 参数：无
 * 返回值：无
 */
function loadData() {
    fetch(DATA_URL)
        .then(function (r) { return r.json(); })
        .then(function (data) {
            allData = data;
            // 预生成小写搜索索引，避免每次筛选重复 toLowerCase
            allData.flights.forEach(function (f) {
                f._search = [f.flight_number, f.departure_city, f.arrival_city,
                    f.departure_province, f.arrival_province, f.product].join(' ').toLowerCase();
            });
            processFilters(data);
            updateStats(data);
            document.getElementById('footer-version').textContent = data.data_version || '未知';
            loadFlights(1);
        })
        .catch(function (err) {
            console.error('加载数据失败:', err);
            hideLoading();
            document.getElementById('no-data').style.display = 'block';
        });
}

/**
 * 根据数据填充省份/城市筛选下拉框
 * 参数：data - 航线数据对象 { flights: [...] }
 * 返回值：无
 */
function processFilters(data) {
    const provinces = new Set();
    const depCities = new Set();
    const arrCities = new Set();

    data.flights.forEach(function (f) {
        provinces.add(f.departure_province);
        provinces.add(f.arrival_province);
        depCities.add(f.departure_city);
        arrCities.add(f.arrival_city);
    });

    fillSelect('province-filter', sortPinyin(provinces), '所有省份');
    fillSelect('dep-city-filter', sortPinyin(depCities), '所有出港城市');
    fillSelect('arr-city-filter', sortPinyin(arrCities), '所有到港城市');
}

/**
 * 向下拉框填充选项
 * 参数：id - select 元素 ID；items - 选项数组；placeholder - 默认选项文案
 * 返回值：无
 */
function fillSelect(id, items, placeholder) {
    const el = document.getElementById(id);
    el.innerHTML = '<option value="all">' + placeholder + '</option>' +
        items.map(function (v) { return '<option value="' + escapeAttr(v) + '">' + escapeHtml(v) + '</option>'; }).join('');
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

/**
 * 应用筛选条件（省份/城市/产品/搜索），生成 filteredFlights
 * 参数：无（读取页面控件状态）
 * 返回值：无
 */
function applyFilters() {
    const province = document.getElementById('province-filter').value;
    const depCity = document.getElementById('dep-city-filter').value;
    const arrCity = document.getElementById('arr-city-filter').value;
    const search = document.getElementById('search-input').value.trim().toLowerCase();

    let flights = allData.flights;

    if (province !== 'all') {
        flights = flights.filter(function (f) {
            return f.departure_province === province || f.arrival_province === province;
        });
    }
    if (depCity !== 'all') {
        flights = flights.filter(function (f) { return f.departure_city === depCity; });
    }
    if (arrCity !== 'all') {
        flights = flights.filter(function (f) { return f.arrival_city === arrCity; });
    }
    // 产品 token 匹配：'666/2666' 同时适用两种产品；
    // 点 666 → 含 666 的航班，点 2666 → 含 2666 的航班（含双产品记录）
    if (selectedProduct !== 'all') {
        flights = flights.filter(function (f) {
            return (f.product || '').split('/').indexOf(selectedProduct) !== -1;
        });
    }
    if (search) {
        flights = flights.filter(function (f) { return f._search.indexOf(search) !== -1; });
    }

    filteredFlights = flights.slice().sort(compareFlights);
}

/**
 * 排序比较函数：按当前 sortKey/sortDir 对两条航线排序
 * 参数：a、b - 两条航线记录对象
 * 返回值：Number，负数表示 a 在前
 */
function compareFlights(a, b) {
    if (!sortKey) return 0;  // 未选择排序列时保持数据原始顺序
    let va = a[sortKey] || '';
    let vb = b[sortKey] || '';
    if (va < vb) return -1 * sortDir;
    if (va > vb) return 1 * sortDir;
    return 0;
}

/**
 * 设置排序列并切换升降序，随后刷新列表
 * 参数：key - 排序字段名
 * 返回值：无
 */
function setSortKey(key) {
    if (sortKey === key) {
        sortDir = -sortDir;
    } else {
        sortKey = key;
        sortDir = 1;
    }
    updateSortIcons();
    loadFlights(currentPage);
}

/**
 * 更新表头排序图标状态
 * 参数：无
 * 返回值：无
 */
function updateSortIcons() {
    document.querySelectorAll('#flights-table thead th[data-sort]').forEach(function (th) {
        th.classList.remove('sorted-asc', 'sorted-desc');
        const icon = th.querySelector('.sort-icon');
        if (th.dataset.sort === sortKey) {
            th.classList.add(sortDir === 1 ? 'sorted-asc' : 'sorted-desc');
            icon.className = 'bi sort-icon ' + (sortDir === 1 ? 'bi-caret-up-fill' : 'bi-caret-down-fill');
        } else {
            icon.className = 'bi bi-arrow-down-up sort-icon';
        }
    });
}

/**
 * 加载并渲染指定页的航班数据
 * 参数：page - 目标页码（从 1 开始）
 * 返回值：无
 */
function loadFlights(page) {
    currentPage = page || 1;
    applyFilters();

    const total = filteredFlights.length;
    totalPages = total > 0 ? Math.ceil(total / PAGE_SIZE) : 0;
    if (totalPages > 0 && currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    displayFlights(filteredFlights.slice(start, start + PAGE_SIZE), total);
}

/**
 * 渲染当前页航班行与结果计数
 * 参数：rows - 当前页航线数组；total - 筛选后总条数
 * 返回值：无
 */
function displayFlights(rows, total) {
    const container = document.getElementById('flights-container');
    const tableWrap = document.getElementById('table-wrap');
    const noData = document.getElementById('no-data');

    document.getElementById('result-count').textContent = '共 ' + total + ' 条';

    if (rows.length === 0) {
        tableWrap.style.display = 'none';
        noData.style.display = 'block';
        document.getElementById('pagination').style.display = 'none';
        hideLoading();
        return;
    }

    const html = rows.map(function (f) {
        return '<tr>' +
            '<td class="fw-semibold">' + escapeHtml(f.flight_number) + '</td>' +
            '<td>' + escapeHtml(f.departure_city) + '</td>' +
            '<td>' + escapeHtml(f.arrival_city) + '</td>' +
            '<td>' + escapeHtml(f.departure_time) + '</td>' +
            '<td title="班期代码: ' + escapeAttr(f.schedule) + '">' + scheduleText(f.schedule) + '</td>' +
            '<td>' + escapeHtml(f.date_range || '-') + '</td>' +
            '<td>' + escapeHtml(f.product) + '</td>' +
            '<td>' + escapeHtml(f.departure_province) + '</td>' +
            '<td>' + escapeHtml(f.arrival_province) + '</td>' +
            '</tr>';
    }).join('');

    container.innerHTML = html;
    tableWrap.style.display = 'block';
    noData.style.display = 'none';
    renderPagination();
    hideLoading();
}

/**
 * 将班期代码转换为易读文本（如 246 → 二/四/六，1234567 → 每日）
 * 参数：code - 班期数字字符串
 * 返回值：String 展示文本
 */
function scheduleText(code) {
    if (code === '1234567') return '每日';
    return String(code).split('').map(function (d) { return WEEK_MAP[d] || d; }).join('/');
}

/**
 * 渲染分页控件
 * 参数：无（读取 currentPage/totalPages）
 * 返回值：无
 */
function renderPagination() {
    const pagination = document.getElementById('pagination');
    if (totalPages <= 1) {
        pagination.style.display = 'none';
        pagination.innerHTML = '';
        return;
    }
    pagination.style.display = 'block';
    let html = '<nav aria-label="航线分页"><ul class="pagination pagination-sm justify-content-center mb-0">';

    html += '<li class="page-item' + (currentPage === 1 ? ' disabled' : '') + '"><a class="page-link" href="#" data-page="' + (currentPage - 1) + '">上一页</a></li>';

    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);
    if (start > 1) {
        html += '<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>';
        if (start > 2) html += '<li class="page-item disabled"><span class="page-link">…</span></li>';
    }
    for (let i = start; i <= end; i++) {
        html += '<li class="page-item' + (i === currentPage ? ' active' : '') + '"><a class="page-link" href="#" data-page="' + i + '">' + i + '</a></li>';
    }
    if (end < totalPages) {
        if (end < totalPages - 1) html += '<li class="page-item disabled"><span class="page-link">…</span></li>';
        html += '<li class="page-item"><a class="page-link" href="#" data-page="' + totalPages + '">' + totalPages + '</a></li>';
    }

    html += '<li class="page-item' + (currentPage === totalPages ? ' disabled' : '') + '"><a class="page-link" href="#" data-page="' + (currentPage + 1) + '">下一页</a></li>';
    html += '</ul></nav>';
    pagination.innerHTML = html;
}

// 分页点击（事件委托，避免内联 onclick）
document.addEventListener('click', function (e) {
    const link = e.target.closest('#pagination a.page-link[data-page]');
    if (link) {
        e.preventDefault();
        gotoPage(parseInt(link.dataset.page, 10));
    }
});

/**
 * 跳转到指定页码
 * 参数：page - 目标页码
 * 返回值：无
 */
function gotoPage(page) {
    if (page < 1 || page > totalPages) return;
    loadFlights(page);
    document.getElementById('table-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 设置产品筛选并刷新列表
 * 参数：value - 产品标识（all / 666 / 2666）
 * 返回值：无
 */
function setProductSelection(value) {
    selectedProduct = value;
    document.querySelectorAll('.product-chip-group button').forEach(function (btn) {
        const isActive = btn.dataset.product === value;
        btn.classList.toggle('btn-hna', isActive);
        btn.classList.toggle('btn-outline-hna', !isActive);
    });
    loadFlights(1);
}

/**
 * 重置全部筛选条件并刷新列表
 * 参数：无
 * 返回值：无
 */
function resetFilters() {
    document.getElementById('search-input').value = '';
    document.getElementById('province-filter').value = 'all';
    document.getElementById('dep-city-filter').value = 'all';
    document.getElementById('arr-city-filter').value = 'all';
    sortKey = null;
    sortDir = 1;
    updateSortIcons();
    setProductSelection('all');
}

/**
 * 打开统计弹窗，展示各省份航线分布与产品分布
 * 参数：无
 * 返回值：无
 */
function loadStatistics() {
    const provinceStats = {};
    const productStats = {};
    filteredFlights.forEach(function (f) {
        provinceStats[f.departure_province] = (provinceStats[f.departure_province] || 0) + 1;
        provinceStats[f.arrival_province] = (provinceStats[f.arrival_province] || 0) + 1;
        productStats[f.product] = (productStats[f.product] || 0) + 1;
    });

    const maxCount = Math.max.apply(null, Object.values(provinceStats).concat([1]));
    const sortedStats = Object.entries(provinceStats).sort(function (a, b) { return b[1] - a[1]; });

    let html = '<div class="mb-3 d-flex gap-3 flex-wrap">' +
        '<span class="badge bg-hna">数据版本: ' + escapeHtml(allData.data_version || '未知') + '</span>' +
        '<span class="badge bg-hna">当前筛选: ' + filteredFlights.length + ' 条</span>';
    Object.entries(productStats).forEach(function (kv) {
        html += '<span class="small text-muted">' + escapeHtml(kv[0]) + ' × ' + kv[1] + '</span>';
    });
    html += '</div><h6 class="text-muted">各省份航线分布（出港+到港）:</h6><div class="row g-2">';

    sortedStats.forEach(function (kv) {
        const pct = Math.round(kv[1] / maxCount * 100);
        html += '<div class="col-md-6"><div class="d-flex align-items-center gap-2">' +
            '<span style="width:64px" class="small text-truncate" title="' + escapeAttr(kv[0]) + '">' + escapeHtml(kv[0]) + '</span>' +
            '<div class="progress flex-grow-1" style="height:14px">' +
            '<div class="progress-bar" role="progressbar" style="width:' + pct + '%;background-color:var(--hna-primary)"></div>' +
            '</div><span class="small fw-semibold">' + kv[1] + '</span></div></div>';
    });
    html += '</div>';

    document.getElementById('statistics-content').innerHTML = html;
    statisticsModal.show();
}

/**
 * 更新顶部统计卡片（总数、版本、覆盖省份数）
 * 参数：data - 航线数据对象
 * 返回值：无
 */
function updateStats(data) {
    document.getElementById('total-flights').textContent = data.total_flights || data.flights.length || 0;
    document.getElementById('data-version').textContent = data.data_version || '未知';
    document.getElementById('season-text').textContent = data.season || '';

    const uniqueProvinces = new Set();
    data.flights.forEach(function (f) {
        uniqueProvinces.add(f.departure_province);
        uniqueProvinces.add(f.arrival_province);
    });
    document.getElementById('total-provinces').textContent = uniqueProvinces.size;
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
 * 属性值转义（用于 title/value 等属性）
 * 参数：text - 原始字符串
 * 返回值：String 转义后的字符串
 */
function escapeAttr(text) {
    return escapeHtml(text);
}

/**
 * 显示加载状态
 * 参数：无
 * 返回值：无
 */
function showLoading() {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('table-wrap').style.display = 'none';
    document.getElementById('no-data').style.display = 'none';
}

/**
 * 隐藏加载状态
 * 参数：无
 * 返回值：无
 */
function hideLoading() {
    document.getElementById('loading').style.display = 'none';
}
