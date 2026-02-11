#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
海航航线数据Web展示系统 - Flask应用
"""

from flask import Flask, render_template, request, jsonify
from crawler import HNAirlineCrawler
from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime
import json
import os
from pypinyin import lazy_pinyin
import webbrowser

app = Flask(__name__)

# 初始化爬虫
crawler = HNAirlineCrawler()

# 创建定时任务调度器
scheduler = BackgroundScheduler()

# 是否启用后端更新API（默认关闭，仅内部运维需要时开启）
ENABLE_UPDATE_API = os.environ.get('ENABLE_UPDATE_API', '0') == '1'

# 确保在 WSGI/Gunicorn 部署时也会进行一次初始抓取
def ensure_initial_data():
    try:
        if not os.path.exists(crawler.data_file):
            print("首次部署，初始化抓取一次数据...")
            crawler.crawl_and_save()
    except Exception as e:
        print(f"初始化抓取失败: {e}")

ensure_initial_data()

def sort_by_pinyin(items):
    try:
        return sorted(items, key=lambda s: ''.join(lazy_pinyin(s)))
    except Exception:
        return sorted(items)

@app.route('/')
def index():
    """主页 - 显示航线数据"""
    data = crawler.load_data()
    source_last_update = crawler.get_source_last_update()
    
    # 获取所有省份用于筛选
    provinces = set()
    dep_cities = set()
    arr_cities = set()
    products = set()
    for flight in data.get('flights', []):
        provinces.add(flight['departure_province'])
        provinces.add(flight['arrival_province'])
        dep_cities.add(flight['departure_city'])
        arr_cities.add(flight['arrival_city'])
        products.add(flight['product'])
    
    return render_template('index.html', 
                         data=data,
                         source_last_update=source_last_update,
                         provinces=sorted(provinces),
                         dep_cities=sort_by_pinyin(dep_cities),
                         arr_cities=sort_by_pinyin(arr_cities),
                         products=sorted(products))

def _build_flights_response():
    """API接口 - 获取航班数据"""
    data = crawler.load_data()
    
    # 处理筛选参数
    province = request.args.get('province')
    search = request.args.get('search', '').lower()
    dep_city = request.args.get('departure_city')
    arr_city = request.args.get('arrival_city')
    product = request.args.get('product')
    product_contains = request.args.get('product_contains', '').lower()
    
    flights = data.get('flights', [])
    
    # 应用筛选
    if province and province != 'all':
        flights = [f for f in flights 
                  if f['departure_province'] == province or f['arrival_province'] == province]
    if dep_city and dep_city != 'all':
        flights = [f for f in flights if f['departure_city'] == dep_city]
    if arr_city and arr_city != 'all':
        flights = [f for f in flights if f['arrival_city'] == arr_city]
    if product and product != 'all':
        flights = [f for f in flights if f['product'] == product]
    if product_contains:
        def match_product_contains(f):
            p = (f.get('product') or '').lower()
            # 以'/'分隔标识，精确匹配其中的项，例如 '666' 或 '666/2666'
            tokens = [t.strip() for t in p.split('/')]
            return product_contains in tokens
        flights = [f for f in flights if match_product_contains(f)]
    
    # 应用搜索
    if search:
        flights = [f for f in flights 
                  if search in f['flight_number'].lower() or 
                     search in f['departure_city'].lower() or 
                     search in f['arrival_city'].lower()]
    
    total = len(flights)
    page = request.args.get('page', '1')
    page_size = request.args.get('page_size', '30')
    try:
        page = max(1, int(page))
    except Exception:
        page = 1
    try:
        page_size = int(page_size)
    except Exception:
        page_size = 30
    if page_size < 1:
        page_size = 30
    if page_size > 200:
        page_size = 200
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0
    if total_pages > 0 and page > total_pages:
        page = total_pages
    start = (page - 1) * page_size
    flights_page = flights[start:start + page_size]

    return {
        'success': True,
        'data': flights_page,
        'total': total,
        'page': page,
        'page_size': page_size,
        'total_pages': total_pages,
        'last_update': data.get('last_update', '未知'),
        'source_last_update': crawler.get_source_last_update()
    }

def _build_statistics_response():
    """API接口 - 获取统计数据"""
    data = crawler.load_data()
    
    # 计算省份统计
    province_stats = {}
    for flight in data.get('flights', []):
        dep_province = flight['departure_province']
        arr_province = flight['arrival_province']
        
        province_stats[dep_province] = province_stats.get(dep_province, 0) + 1
        province_stats[arr_province] = province_stats.get(arr_province, 0) + 1
    
    return {
        'success': True,
        'province_stats': province_stats,
        'total_flights': data.get('total_flights', 0),
        'last_update': data.get('last_update', '未知'),
        'source_last_update': crawler.get_source_last_update()
    }

@app.route('/data_proxy')
def data_proxy():
    """统一对外数据入口，通过 action 路由内部功能，隐藏真实接口路径"""
    action = request.args.get('action', 'flights')
    if action == 'flights':
        return jsonify(_build_flights_response())
    elif action == 'statistics':
        return jsonify(_build_statistics_response())
    else:
        return jsonify({'success': False, 'message': '未知操作'}), 404

if ENABLE_UPDATE_API:
    @app.route('/api/update', methods=['POST'])
    def api_update():
        """API接口（仅在内部开启） - 刷新本地JSON并重算省份，不触发外网抓取"""
        try:
            data = crawler.load_data()
            flights = data.get('flights', [])

            # 仅重算省份映射，避免外网抓取造成频繁访问
            for f in flights:
                f['departure_province'] = crawler.get_province(f.get('departure_city', ''))
                f['arrival_province'] = crawler.get_province(f.get('arrival_city', ''))

            # 保存回JSON，但保留原有last_update时间戳
            save_obj = {
                'last_update': data.get('last_update', '未知'),
                'total_flights': data.get('total_flights', len(flights)),
                'flights': flights
            }
            with open(crawler.data_file, 'w', encoding='utf-8') as fobj:
                json.dump(save_obj, fobj, ensure_ascii=False, indent=2)

            return jsonify({
                'success': True,
                'message': '已刷新本地JSON并修正省份映射',
                'total_flights': len(flights),
                'last_update': save_obj['last_update']
            })
        except Exception as e:
            return jsonify({'success': False, 'message': f'刷新失败: {e}'})

def scheduled_crawl():
    """定时抓取任务"""
    print(f"[{datetime.now()}] 执行定时抓取任务...")
    crawler.crawl_and_save()

if os.environ.get('WERKZEUG_RUN_MAIN') == 'true' or not app.debug:
    scheduler.add_job(scheduled_crawl, 'cron', hour=2, minute=0)
    scheduler.start()

@app.route('/api/missing_cities')
def api_missing_cities():
    """诊断接口：返回省份为“其他”的城市列表与计数"""
    data = crawler.load_data()
    flights = data.get('flights', [])

    missing_dep = {}
    missing_arr = {}
    for f in flights:
        if f.get('departure_province') == '其他':
            c = f.get('departure_city', '未知')
            missing_dep[c] = missing_dep.get(c, 0) + 1
        if f.get('arrival_province') == '其他':
            c = f.get('arrival_city', '未知')
            missing_arr[c] = missing_arr.get(c, 0) + 1

    return jsonify({
        'success': True,
        'missing_departure_cities': missing_dep,
        'missing_arrival_cities': missing_arr,
        'total_missing': sum(missing_dep.values()) + sum(missing_arr.values())
    })

if __name__ == '__main__':
    # 首次启动时立即抓取一次数据
    if not os.path.exists(crawler.data_file):
        print("首次启动，开始抓取数据...")
        crawler.crawl_and_save()
    
    host = os.environ.get('HOST', '0.0.0.0')
    port = os.environ.get('PORT', '5000')
    try:
        port = int(port)
    except Exception:
        port = 5000

    url = f"http://127.0.0.1:{port}"
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true' or not app.debug:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    app.run(debug=True, host=host, port=port)
