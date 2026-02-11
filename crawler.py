#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
海航航线数据抓取器 - 定时任务版本
"""

import requests
import re
from bs4 import BeautifulSoup
import json
import os
import time
from datetime import datetime
from typing import List, Dict, Any

class HNAirlineCrawler:
    """海航航线抓取器"""
    
    def __init__(self):
        self.urls = [
            "https://m.hnair.com/cms/me/plus/info/202508/t20250808_78914.html",
            "https://m.hnair.com/cms/me/plus/syhx/202512/t20251229_82220.html",
        ]
        self.url = self.urls[0]
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        self.data_file = "hainan_airlines_data.json"
        self.province_mapping = self._create_province_mapping()
        self._data_cache = None
        self._data_cache_mtime = None
        self._source_last_update_cache = None
        self._source_last_update_time = 0
        self._source_last_update_ttl = 1800
    
    def _create_province_mapping(self) -> Dict[str, str]:
        """创建城市到省份的映射"""
        return {
            '北京': '北京', '上海': '上海', '天津': '天津', '重庆': '重庆',
            # 新疆
            '阿克苏': '新疆', '乌鲁木齐': '新疆', '喀什': '新疆', '哈密': '新疆', '塔城': '新疆', '那拉提': '新疆', '图木舒克': '新疆',
            '博乐': '新疆', '库尔勒': '新疆', '库车': '新疆', '伊宁': '新疆', '于田': '新疆', '和田': '新疆', '石河子': '新疆',
            '阿勒泰': '新疆', '阿拉尔': '新疆',
            # 陕西
            '西安': '陕西', '咸阳': '陕西', '延安': '陕西', '榆林': '陕西', '汉中': '陕西', '安康': '陕西',
            # 河南
            '郑州': '河南', '洛阳': '河南', '安阳': '河南', '南阳': '河南', '信阳': '河南',
            # 安徽
            '安庆': '安徽', '合肥': '安徽', '黄山': '安徽', '池州': '安徽', '亳州': '安徽', '阜阳': '安徽',
            # 海南
            '海口': '海南', '三亚': '海南', '琼海': '海南',
            # 浙江
            '杭州': '浙江', '宁波': '浙江', '温州': '浙江', '台州': '浙江', '舟山': '浙江', '丽水': '浙江',
            # 四川
            '成都': '四川', '天府': '四川', '绵阳': '四川', '泸州': '四川', '巴中': '四川', '南充': '四川', '达州': '四川',
            # 云南
            '大理': '云南', '西双版纳': '云南', '昆明': '云南', '芒市': '云南', '丽江': '云南', '腾冲': '云南',
            '香格里拉': '云南', '沧源': '云南', '澜沧': '云南',
            # 辽宁
            '大连': '辽宁', '沈阳': '辽宁',
            # 山东
            '青岛': '山东', '济南': '山东', '临沂': '山东', '威海': '山东', '烟台': '山东', '潍坊': '山东',
            '日照': '山东', '东营': '山东', '济宁': '山东',
            '广州': '广东', '深圳': '广东', '惠州': '广东', '珠海': '广东',
            '揭阳': '广东', '湛江': '广东', '韶关': '广东',
            # 江苏/湖南
            '南京': '江苏', '苏州': '江苏', '长沙': '湖南', '张家界': '湖南', '常州': '江苏', '无锡': '江苏',
            '南通': '江苏', '徐州': '江苏', '扬州': '江苏', '淮安': '江苏', '盐城': '江苏', '连云港': '江苏',
            '衡阳': '湖南', '湘西': '湖南', '郴州': '湖南', '邵阳': '湖南', '永州': '湖南', '岳阳': '湖南',
            # 东北
            '哈尔滨': '黑龙江', '鸡西': '黑龙江', '大庆': '黑龙江', '长春': '吉林', '吉林': '吉林',
            '沈阳': '辽宁',
            # 华北
            '石家庄': '河北', '秦皇岛': '河北', '太原': '山西', '大同': '山西', '唐山': '河北', '邯郸': '河北',
            '邢台': '河北', '张家口': '河北', '长治': '山西', '吕梁': '山西',
            # 西北
            '呼和浩特': '内蒙古', '包头': '内蒙古', '兰州': '甘肃', '敦煌': '甘肃', '张掖': '甘肃', '金昌': '甘肃',
            '西宁': '青海', '银川': '宁夏', '中卫': '宁夏', '拉萨': '西藏', '昌都': '西藏', '林芝': '西藏', '南宁': '广西',
            '桂林': '广西', '北海': '广西', '柳州': '广西', '玉林': '广西',
            # 贵州
            '贵阳': '贵州', '茅台': '贵州', '遵义': '贵州',
            '福州': '福建', '厦门': '福建', '泉州': '福建',
            # 江西
            '南昌': '江西', '赣州': '江西', '九江': '江西', '宜春': '江西', '上饶': '江西', '井冈山': '江西',
            # 内蒙古
            '二连浩特': '内蒙古', '阿尔山': '内蒙古', '满洲里': '内蒙古', '呼伦贝尔': '内蒙古', '霍林郭勒': '内蒙古',
            '乌海': '内蒙古', '乌兰浩特': '内蒙古', '通辽': '内蒙古', '赤峰': '内蒙古', '鄂尔多斯': '内蒙古', '锡林浩特': '内蒙古',
            '玉树': '青海',
            '安阳': '河南', '洛阳': '河南',
            '恩施': '湖北',
            '十堰': '湖北',
            '庆阳': '甘肃', '陇南': '甘肃',
            '合肥': '安徽',
            # 其他较常见城市
            '武汉': '湖北', '宜昌': '湖北', '荆州': '湖北', '襄阳': '湖北',
            '温州': '浙江', '宁波': '浙江', '台州': '浙江', '舟山': '浙江',
            '张家界': '湖南', '怀化': '湖南',
            '唐山': '河北',
            '威海': '山东',
            '通辽': '内蒙古'
        }

    def get_province(self, city: str) -> str:
        """根据城市获取省份"""
        # 标准化常见机场/城市别名，提升匹配准确性
        aliases = {
            '北京首都': '北京', '北京大兴': '北京',
            '上海浦东': '上海', '上海虹桥': '上海',
            '成都天府': '成都',
        }
        norm_city = aliases.get(city, city)

        for key, value in self.province_mapping.items():
            if key in norm_city:
                return value
        return '其他'
    
    def fetch_html_from(self, url: str) -> str:
        try:
            response = requests.get(url, headers=self.headers, timeout=10)
            response.encoding = 'utf-8'
            return response.text
        except Exception as e:
            print(f"获取网页内容失败: {e}")
            return ""

    def fetch_html(self) -> str:
        try:
            return self.fetch_html_from(self.url)
        except Exception as e:
            print(f"获取网页内容失败: {e}")
            return ""

    def get_source_last_update(self) -> str:
        now = time.time()
        if self._source_last_update_cache and now - self._source_last_update_time < self._source_last_update_ttl:
            return self._source_last_update_cache
        best = None
        for u in self.urls:
            m = re.search(r"t(\d{8})_", u)
            if not m:
                continue
            raw = m.group(1)
            value = f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"
            best = max(best, value) if best else value
        self._source_last_update_cache = best or (self._source_last_update_cache or '未知')
        self._source_last_update_time = now
        return self._source_last_update_cache
    
    def parse_flight_data(self, html: str) -> List[Dict[str, Any]]:
        """解析航班数据"""
        soup = BeautifulSoup(html, 'html.parser')
        flight_data = []
        
        # 查找表格行
        rows = soup.find_all('tr')
        
        for row in rows:
            cells = row.find_all('td')
            if len(cells) >= 6:
                flight_number = cells[0].get_text(strip=True)
                departure_city = cells[1].get_text(strip=True)
                
                # 跳过表头行（包含"航班号"、"出港城市"等文本的行）
                if flight_number == '航班号' or departure_city == '出港城市':
                    continue
                    
                flight_info = {
                    'flight_number': flight_number,
                    'departure_city': departure_city,
                    'arrival_city': cells[2].get_text(strip=True),
                    'departure_time': cells[3].get_text(strip=True),
                    'schedule': cells[4].get_text(strip=True),
                    'product': cells[5].get_text(strip=True),
                    'departure_province': self.get_province(departure_city),
                    'arrival_province': self.get_province(cells[2].get_text(strip=True))
                }
                flight_data.append(flight_info)
        
        return flight_data
    
    def crawl_and_save(self):
        print(f"[{datetime.now()}] 开始抓取海航航线数据...")
        base = self.load_data()
        existing = base.get('flights', [])
        by_key = {}
        for f in existing:
            k = f"{f.get('flight_number','')}|{f.get('departure_city','')}|{f.get('arrival_city','')}"
            by_key[k] = f
        total_new = 0
        for u in self.urls:
            html = self.fetch_html_from(u)
            if not html:
                continue
            items = self.parse_flight_data(html)
            total_new += len(items)
            for f in items:
                k = f"{f.get('flight_number','')}|{f.get('departure_city','')}|{f.get('arrival_city','')}"
                by_key[k] = f
        merged = list(by_key.values())
        data = {
            'last_update': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'total_flights': len(merged),
            'flights': merged
        }
        with open(self.data_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"[{datetime.now()}] 成功合并 {len(merged)} 条航线数据（新增来源 {total_new} 条），已保存到 {self.data_file}")
        return True
    
    def load_data(self) -> Dict[str, Any]:
        """加载数据"""
        if not os.path.exists(self.data_file):
            self._data_cache = None
            self._data_cache_mtime = None
            return {'flights': [], 'last_update': '从未更新', 'total_flights': 0}
        
        try:
            mtime = os.path.getmtime(self.data_file)
            if self._data_cache is not None and self._data_cache_mtime == mtime:
                return self._data_cache
            with open(self.data_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                self._data_cache = data
                self._data_cache_mtime = mtime
                return data
        except:
            self._data_cache = None
            self._data_cache_mtime = None
            return {'flights': [], 'last_update': '数据损坏', 'total_flights': 0}

def run_crawler():
    """运行抓取器"""
    crawler = HNAirlineCrawler()
    crawler.crawl_and_save()

if __name__ == "__main__":
    run_crawler()
