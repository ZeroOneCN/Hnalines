/**
 * 海航随心飞航线 - 前端逻辑
 */

const DATA_URL = 'hainan_airlines_data.json';

let currentPage = 1;
const pageSize = 30;
let totalPages = 0;
let currentFlights = [];
let allData = { flights: [], last_update: '未知', total_flights: 0 };
let provinces = new Set();
let depCities = new Set();
let arrCities = new Set();
let products = new Set();

// 页面加载时获取数据
document.addEventListener('DOMContentLoaded', function() {
    loadData();
});

// 加载数据
function loadData() {
    showLoading();
    fetch(DATA_URL)
        .then(response => response.json())
        .then(data => {
            allData = data;
            processFilters(data);
            updateStats(data);
            loadFlights(1);
        })
        .catch(error => {
            console.error('加载数据失败:', error);
            hideLoading();
            document.getElementById('no-data').style.display = 'block';
        });
}

// 处理筛选器数据
function processFilters(data) {
    provinces = new Set();
    depCities = new Set();
    arrCities = new Set();
    products = new Set();

    data.flights.forEach(flight => {
        provinces.add(flight.departure_province);
        provinces.add(flight.arrival_province);
        depCities.add(flight.departure_city);
        arrCities.add(flight.arrival_city);
        products.add(flight.product);
    });

    // 填充省份筛选
    const provinceFilter = document.getElementById('province-filter');
    provinceFilter.innerHTML = '<option value="all">所有省份</option>';
    sortPinyin(provinces).forEach(province => {
        provinceFilter.innerHTML += `<option value="${province}">${province}</option>`;
    });

    // 填充出发城市筛选
    const depCityFilter = document.getElementById('dep-city-filter');
    depCityFilter.innerHTML = '<option value="all">所有出港城市</option>';
    sortPinyin(depCities).forEach(city => {
        depCityFilter.innerHTML += `<option value="${city}">${city}</option>`;
    });

    // 填充到达城市筛选
    const arrCityFilter = document.getElementById('arr-city-filter');
    arrCityFilter.innerHTML = '<option value="all">所有到港城市</option>';
    sortPinyin(arrCities).forEach(city => {
        arrCityFilter.innerHTML += `<option value="${city}">${city}</option>`;
    });

    // 绑定事件
    provinceFilter.addEventListener('change', () => loadFlights(1));
    depCityFilter.addEventListener('change', () => loadFlights(1));
    arrCityFilter.addEventListener('change', () => loadFlights(1));

    // 产品按钮事件
    document.getElementById('product-all').addEventListener('click', () => setProductSelection('all'));
    document.getElementById('product-666').addEventListener('click', () => setProductSelection('666'));
    document.getElementById('product-2666').addEventListener('click', () => setProductSelection('2666'));
    setProductSelection('all');
}

// 拼音排序
function sortPinyin(items) {
    try {
        return Array.from(items).sort((a, b) => {
            return a.localeCompare(b, 'zh-Hans-CN', { sensitivity: 'accent' });
        });
    } catch (e) {
        return Array.from(items).sort();
    }
}

// 加载航班数据
function loadFlights(page) {
    if (page) {
        currentPage = page;
    } else {
        currentPage = 1;
    }

    const province = document.getElementById('province-filter').value;
    const search = document.getElementById('search-input').value;
    const depCity = document.getElementById('dep-city-filter').value;
    const arrCity = document.getElementById('arr-city-filter').value;
    const product = window.selectedProduct || 'all';

    let flights = allData.flights.slice();

    // 应用筛选
    if (province !== 'all') {
        flights = flights.filter(f =>
            f.departure_province === province || f.arrival_province === province
        );
    }
    if (depCity !== 'all') {
        flights = flights.filter(f => f.departure_city === depCity);
    }
    if (arrCity !== 'all') {
        flights = flights.filter(f => f.arrival_city === arrCity);
    }
    if (product === '666') {
        flights = flights.filter(f => {
            const tokens = (f.product || '').split('/').map(t => t.trim().toLowerCase());
            return tokens.includes('666');
        });
    } else if (product !== 'all') {
        flights = flights.filter(f => f.product === product);
    }

    // 应用搜索
    if (search) {
        const searchLower = search.toLowerCase();
        flights = flights.filter(f =>
            f.flight_number.toLowerCase().includes(searchLower) ||
            f.departure_city.toLowerCase().includes(searchLower) ||
            f.arrival_city.toLowerCase().includes(searchLower)
        );
    }

    // 分页
    total = flights.length;
    totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
    if (totalPages > 0 && currentPage > totalPages) {
        currentPage = totalPages;
    }
    const start = (currentPage - 1) * pageSize;
    const flightsPage = flights.slice(start, start + pageSize);

    currentFlights = flightsPage;
    displayFlights(total);
}

// 显示航班数据
function displayFlights(total) {
    const container = document.getElementById('flights-container');
    container.innerHTML = '';

    if (currentFlights.length === 0) {
        document.getElementById('no-data').style.display = 'block';
        hideLoading();
        return;
    }

    document.getElementById('no-data').style.display = 'none';

    const html = currentFlights.map(flight => `
        <tr>
            <td>${escapeHtml(flight.flight_number)}</td>
            <td>${escapeHtml(flight.departure_city)}</td>
            <td>${escapeHtml(flight.arrival_city)}</td>
            <td>${escapeHtml(flight.departure_time)}</td>
            <td>${escapeHtml(flight.schedule)}</td>
            <td>${escapeHtml(flight.product)}</td>
            <td>${escapeHtml(flight.departure_province)}</td>
            <td>${escapeHtml(flight.arrival_province)}</td>
        </tr>
    `).join('');

    container.innerHTML = html;
    renderPagination();
    hideLoading();
}

// HTML 转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 渲染分页
function renderPagination() {
    const pagination = document.getElementById('pagination');
    if (totalPages <= 1) {
        pagination.style.display = 'none';
        pagination.innerHTML = '';
        return;
    }
    pagination.style.display = 'block';
    let html = '<nav aria-label="航线分页"><ul class="pagination justify-content-center">';

    const prevDisabled = currentPage === 1 ? ' disabled' : '';
    html += `<li class="page-item${prevDisabled}"><a class="page-link" href="#" onclick="gotoPage(${currentPage-1});return false;">上一页</a></li>`;

    const total = totalPages;
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(total, currentPage + 2);

    if (start > 1) {
        html += `<li class="page-item"><a class="page-link" href="#" onclick="gotoPage(1);return false;">1</a></li>`;
        if (start > 2) html += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
    }

    for (let i = start; i <= end; i++) {
        const active = i === currentPage ? ' active' : '';
        html += `<li class="page-item${active}"><a class="page-link" href="#" onclick="gotoPage(${i});return false;">${i}</a></li>`;
    }

    if (end < total) {
        if (end < total - 1) html += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
        html += `<li class="page-item"><a class="page-link" href="#" onclick="gotoPage(${total});return false;">${total}</a></li>`;
    }

    const nextDisabled = currentPage === totalPages ? ' disabled' : '';
    html += `<li class="page-item${nextDisabled}"><a class="page-link" href="#" onclick="gotoPage(${currentPage+1});return false;">下一页</a></li>`;
    html += '</ul></nav>';
    pagination.innerHTML = html;
}

function gotoPage(page) {
    if (page < 1 || page > totalPages) return;
    loadFlights(page);
}

// 搜索航班
function searchFlights() {
    showLoading();
    loadFlights(1);
}

// 加载统计信息
function loadStatistics() {
    const data = allData;
    let html = `
        <div class="mb-3">
            <strong>最后更新:</strong> <span class="badge bg-hna">${data.last_update}</span><br>
            <strong>总航线数:</strong> <span class="badge bg-hna">${data.total_flights}</span>
        </div>
        <h6>各省份航线分布:</h6>
        <div class="row">
    `;

    // 计算省份统计
    const provinceStats = {};
    data.flights.forEach(flight => {
        provinceStats[flight.departure_province] = (provinceStats[flight.departure_province] || 0) + 1;
        provinceStats[flight.arrival_province] = (provinceStats[flight.arrival_province] || 0) + 1;
    });

    // 按航线数量排序
    const sortedStats = Object.entries(provinceStats).sort((a, b) => b[1] - a[1]);

    sortedStats.forEach(([province, count]) => {
        html += `
            <div class="col-md-6 mb-2">
                <div class="d-flex justify-content-between">
                    <span>${escapeHtml(province)}</span>
                    <span class="badge bg-hna">${count}</span>
                </div>
            </div>
        `;
    });

    html += '</div>';
    document.getElementById('statistics-content').innerHTML = html;
    new bootstrap.Modal(document.getElementById('statisticsModal')).show();
}

// 更新统计信息
function updateStats(data) {
    document.getElementById('total-flights').textContent = data.total_flights || 0;
    document.getElementById('last-update').textContent = data.last_update || '未知';

    // 计算覆盖省份数
    const uniqueProvinces = new Set();
    data.flights.forEach(f => {
        uniqueProvinces.add(f.departure_province);
        uniqueProvinces.add(f.arrival_province);
    });
    document.getElementById('total-provinces').textContent = uniqueProvinces.size;
}

// 产品选择
function setProductSelection(value) {
    window.selectedProduct = value;
    ['product-all','product-666','product-2666'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const isActive = btn.dataset.product === value;
        btn.classList.toggle('btn-hna', isActive);
        btn.classList.toggle('btn-outline-hna', !isActive);
    });
    loadFlights(1);
}

// 显示加载状态
function showLoading() {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('flights-container').innerHTML = '';
    document.getElementById('no-data').style.display = 'none';
}

// 隐藏加载状态
function hideLoading() {
    document.getElementById('loading').style.display = 'none';
}

// 搜索框回车事件
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('search-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchFlights();
        }
    });
});
