"""
MemPalace 100 回合記憶模擬測試
================================
模擬遊戲 100 回合的記憶寫入與搜索，測量：
  1. 搜索精度（Precision@5）
  2. 去重潛力（近似重複比例）
  3. Token 使用量
  4. Recency 偏差（回傳結果的平均回合距離）
  5. 搜索延遲

用法:
  cd ai-proxy
  pip install chromadb
  python tests/mempalace_simulation.py
"""

import chromadb
import sqlite3
import os
import time
import random
import shutil
import json

# ─── 模擬資料 ───────────────────────────────────────

LOCATIONS = [
    "無名村", "翠雲峰", "黑風谷", "長安城", "少林寺",
    "青雲派", "醉仙樓", "天山雪嶺", "洛陽城", "華山之巔"
]

NPCS = [
    {"name": "王大夫", "role": "醫者", "base": "無名村"},
    {"name": "張三豐", "role": "武當掌門", "base": "翠雲峰"},
    {"name": "黑衣人", "role": "神秘殺手", "base": "黑風谷"},
    {"name": "小蓮", "role": "客棧老闆娘", "base": "醉仙樓"},
    {"name": "鐵手", "role": "山賊頭目", "base": "黑風谷"},
    {"name": "慧明大師", "role": "少林方丈", "base": "少林寺"},
    {"name": "柳如煙", "role": "青雲弟子", "base": "青雲派"},
    {"name": "趙富商", "role": "洛陽首富", "base": "洛陽城"},
    {"name": "雪姬", "role": "天山聖女", "base": "天山雪嶺"},
    {"name": "李捕頭", "role": "長安捕快", "base": "長安城"},
    {"name": "阿寶", "role": "丐幫弟子", "base": "長安城"},
    {"name": "風清揚", "role": "隱世高手", "base": "華山之巔"},
    {"name": "毒娘子", "role": "五毒教主", "base": "黑風谷"},
    {"name": "白鬍子", "role": "說書人", "base": "醉仙樓"},
    {"name": "秦將軍", "role": "長安守將", "base": "長安城"},
]

STORY_TEMPLATES = [
    "你走進{loc}，{npc}正在{action}。{detail}",
    "{npc}看到你來了，{reaction}。你們{interaction}。",
    "在{loc}的街道上，你意外碰見了{npc}。{event}",
    "你在{loc}修練了一會兒，{npc}走了過來。{dialogue}",
    "{loc}的{scene}讓你想起了什麼。{npc}{response}。",
    "一陣{weather}過後，{npc}出現在{loc}。{plot}",
]

ACTIONS = ["看診", "練劍", "喝茶", "打坐", "擦拭兵器", "翻閱古籍", "煮藥", "下棋", "觀星", "品酒"]
REACTIONS = ["微微一笑", "皺了皺眉", "冷哼一聲", "驚喜地叫出聲來", "不動聲色", "嘆了口氣", "露出警惕的神色"]
INTERACTIONS = ["聊了幾句江湖趣聞", "討論了武學心得", "交換了情報", "一起喝了幾杯", "比試了一番", "交易了物品"]
EVENTS = [
    "一場突如其來的暴風雨打斷了你們的談話",
    "遠處傳來一聲淒厲的慘叫",
    "一個神秘的包裹被送到了你的面前",
    "你發現了一本落滿灰塵的古書",
    "一群山賊突然衝了出來",
    "天空出現了奇異的光芒",
]
DIALOGUES = [
    "「你是從哪裡來的？」他好奇地問道。",
    "「最近江湖上不太平啊……」她低聲說道。",
    "「我有一件事想拜託你。」他神色凝重地說。",
    "「聽說黑風谷最近有異動。」",
    "「你可知道那本古書的下落？」",
]
SCENES = ["夕陽", "古井", "老樹", "斷橋", "石碑"]
WEATHERS = ["大雨", "狂風", "濃霧", "雷電", "飄雪"]
PLOTS = [
    "他帶來了關於穿越的線索",
    "她告訴你一個驚人的秘密",
    "一場陰謀正在醞釀",
    "你感到體內真氣湧動",
    "一個被遺忘的真相浮出水面",
]

EVT_TEMPLATES = [
    "在{loc}與{npc}交談",
    "在{loc}發現了{item}",
    "{npc}透露了重要情報",
    "在{loc}遭遇伏擊",
    "學會了新的武學招式",
    "善惡值發生了變化",
    "與{npc}結為好友",
    "在{loc}修煉有成",
]

ITEMS = ["藏寶圖碎片", "解毒丹", "玄鐵匕首", "天蠶絲手套", "內功心法殘卷", "夜明珠"]

# ─── 關鍵測試查詢 ─────────────────────────────────────

# 每個查詢帶有「預期匹配」的 NPC / 地點 / 事件
TEST_QUERIES = [
    {
        "query": "王大夫在哪裡",
        "expected_keywords": ["王大夫"],
        "description": "NPC 位置查詢"
    },
    {
        "query": "翠雲峰發生了什麼事",
        "expected_keywords": ["翠雲峰"],
        "description": "地點事件查詢"
    },
    {
        "query": "黑衣人的身份",
        "expected_keywords": ["黑衣人"],
        "description": "NPC 資訊查詢"
    },
    {
        "query": "穿越回家的線索",
        "expected_keywords": ["穿越", "線索", "秘密", "真相"],
        "description": "主線劇情查詢"
    },
    {
        "query": "最近發生的戰鬥",
        "expected_keywords": ["山賊", "伏擊", "比試"],
        "description": "戰鬥記憶查詢"
    },
    {
        "query": "小蓮對我的態度",
        "expected_keywords": ["小蓮"],
        "description": "NPC 關係查詢"
    },
]


# ─── 模擬引擎 ─────────────────────────────────────────

def generate_round_data(round_num):
    """產生一回合的模擬遊戲資料"""
    loc = random.choice(LOCATIONS)
    npcs_in_scene = random.sample(NPCS, k=random.randint(1, 3))
    main_npc = npcs_in_scene[0]

    # 生成故事
    template = random.choice(STORY_TEMPLATES)
    story = template.format(
        loc=loc,
        npc=main_npc["name"],
        action=random.choice(ACTIONS),
        detail=random.choice(DIALOGUES),
        reaction=random.choice(REACTIONS),
        interaction=random.choice(INTERACTIONS),
        event=random.choice(EVENTS),
        dialogue=random.choice(DIALOGUES),
        scene=random.choice(SCENES),
        response=random.choice(REACTIONS),
        weather=random.choice(WEATHERS),
        plot=random.choice(PLOTS),
    )

    # 生成事件
    evt_template = random.choice(EVT_TEMPLATES)
    evt = evt_template.format(
        loc=loc,
        npc=main_npc["name"],
        item=random.choice(ITEMS)
    )

    # 每 15 回合插入主線劇情相關事件
    if round_num % 15 == 0:
        story += " 你隱約感覺到這個世界藏著穿越的秘密，或許找到那本古書就能發現回家的線索。"
        evt = "發現了關於穿越的重要線索"

    morality_change = random.choice([0, 0, 0, -5, -10, 5, 10, 15])

    return {
        "R": round_num,
        "LOC": [loc],
        "NPC": [{"name": n["name"], "status": random.choice(REACTIONS), "friendliness": random.randint(-20, 80)} for n in npcs_in_scene],
        "EVT": evt,
        "story": story,
        "moralityChange": morality_change,
    }


class MemPalaceSimulator:
    """本地模擬 MemPalace Server 的行為"""

    def __init__(self, test_dir):
        self.test_dir = test_dir
        os.makedirs(test_dir, exist_ok=True)

        # ChromaDB
        self.client = chromadb.PersistentClient(path=os.path.join(test_dir, "chroma_db"))
        self.collection = self.client.get_or_create_collection("mempalace_drawers")

        # SQLite KG
        db_path = os.path.join(test_dir, "knowledge_graph.sqlite3")
        self.kg = sqlite3.connect(db_path)
        self.kg.execute("PRAGMA journal_mode=WAL")
        self.kg.execute("""
            CREATE TABLE IF NOT EXISTS facts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wing TEXT NOT NULL,
                subject TEXT NOT NULL,
                predicate TEXT NOT NULL,
                object TEXT NOT NULL,
                valid_from TEXT,
                ended TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        self.kg.execute("CREATE INDEX IF NOT EXISTS idx_wing ON facts(wing)")
        self.kg.execute("CREATE INDEX IF NOT EXISTS idx_subject ON facts(subject)")
        self.kg.execute("CREATE INDEX IF NOT EXISTS idx_object ON facts(object)")
        self.kg.commit()

        self.doc_counter = 0

    def add_memory(self, wing, room, content, metadata=None):
        metadata = metadata or {}
        self.doc_counter += 1
        doc_id = f"doc_{self.doc_counter}_{os.urandom(4).hex()}"
        self.collection.add(
            documents=[content],
            ids=[doc_id],
            metadatas=[{**metadata, "wing": wing, "room": room}]
        )

    def add_fact(self, wing, subject, predicate, obj, valid_from=""):
        self.kg.execute(
            "INSERT INTO facts (wing, subject, predicate, object, valid_from) VALUES (?, ?, ?, ?, ?)",
            (wing, subject, predicate, obj, valid_from)
        )
        self.kg.commit()

    def save_round_memory(self, player_id, round_data, story):
        wing = f"player_{player_id}"
        round_id = f"R{round_data['R']}"
        loc_arr = round_data.get("LOC", [])
        loc = loc_arr[-1] if isinstance(loc_arr, list) and loc_arr else str(loc_arr)

        # 故事
        if story:
            self.add_memory(wing, "main_story", f"[{round_id}] [{loc}] {story}",
                            {"round": round_data["R"], "location": loc})

        # NPC 互動
        for npc in round_data.get("NPC", []):
            if npc.get("name"):
                self.add_memory(wing, "npc_interactions",
                                f"[{round_id}] 在{loc}遇到{npc['name']}：{npc.get('status', '')}",
                                {"round": round_data["R"], "npc": npc["name"]})
                self.add_fact(wing, npc["name"], "located_at", loc, round_id)

        # 事件
        if round_data.get("EVT"):
            self.add_memory(wing, "events", f"[{round_id}] {round_data['EVT']}",
                            {"round": round_data["R"]})

        # 玩家位置
        if loc:
            self.add_fact(wing, "主角", "located_at", loc, round_id)

        # 善惡值
        mc = round_data.get("moralityChange", 0)
        if mc and mc != 0:
            direction = "偏正" if mc > 0 else "偏邪"
            self.add_fact(wing, "主角", "morality_shift", direction, round_id)

    def search(self, query, wing=None, limit=5):
        where = {"wing": wing} if wing else None
        try:
            results = self.collection.query(
                query_texts=[query],
                n_results=min(limit, 20),
                where=where
            )
            docs = results.get("documents", [[]])[0]
            metas = results.get("metadatas", [[]])[0]
            dists = results.get("distances", [[]])[0]
            return [{"content": docs[i], "metadata": metas[i], "distance": dists[i]}
                    for i in range(len(docs))]
        except Exception as e:
            return []

    def query_entity(self, entity, wing=None):
        query = "SELECT subject, predicate, object, valid_from, ended FROM facts WHERE (subject=? OR object=?) AND ended IS NULL"
        params = [entity, entity]
        if wing:
            query += " AND wing=?"
            params.append(wing)
        query += " ORDER BY id DESC LIMIT 20"
        rows = self.kg.execute(query, params).fetchall()
        return [{"subject": r[0], "predicate": r[1], "object": r[2], "valid_from": r[3], "ended": r[4]} for r in rows]

    def build_deep_memory_context(self, player_id, player_action, npc_names=None):
        npc_names = npc_names or []
        wing = f"player_{player_id}"
        context = ""

        # 行動搜索
        action_results = self.search(player_action, wing, 3)
        if action_results:
            memories = "\n".join(r["content"] for r in action_results)
            context += f"\n【相關歷史記憶】\n{memories}\n"

        # NPC 搜索
        npc_parts = []
        for name in npc_names[:3]:
            results = self.search(name, wing, 2)
            if results:
                npc_parts.append(f"{name}: {'; '.join(r['content'] for r in results)}")
        if npc_parts:
            context += f"\n【NPC 互動歷史】\n" + "\n".join(npc_parts) + "\n"

        # KG 事實
        fact_parts = []
        for name in npc_names[:3]:
            facts = self.query_entity(name, wing)
            if facts:
                fact_parts.append("; ".join(f"{f['subject']} {f['predicate']} {f['object']}" for f in facts))
        if fact_parts:
            context += f"\n【已知事實】\n" + "\n".join(fact_parts) + "\n"

        return context.strip()

    def get_stats(self):
        doc_count = self.collection.count()
        fact_count = self.kg.execute("SELECT COUNT(*) FROM facts").fetchone()[0]
        return {"docs": doc_count, "facts": fact_count}


# ─── 測試函數 ─────────────────────────────────────────

def measure_search_quality(sim, player_id, current_round, round_history):
    """測量搜索品質指標"""
    wing = f"player_{player_id}"
    results_report = []

    for tq in TEST_QUERIES:
        start = time.time()
        results = sim.search(tq["query"], wing, 5)
        latency = (time.time() - start) * 1000

        # 計算 Precision: 多少結果包含預期關鍵字
        hits = 0
        for r in results:
            content = r["content"]
            if any(kw in content for kw in tq["expected_keywords"]):
                hits += 1

        precision = hits / len(results) if results else 0

        # Recency: 回傳結果的平均回合距離
        round_distances = []
        for r in results:
            mem_round = r["metadata"].get("round", 0)
            if mem_round:
                round_distances.append(current_round - mem_round)

        avg_recency = sum(round_distances) / len(round_distances) if round_distances else -1

        # 距離分布
        distances = [r["distance"] for r in results]
        avg_distance = sum(distances) / len(distances) if distances else -1

        results_report.append({
            "query": tq["description"],
            "precision_at_5": f"{precision:.0%}",
            "avg_round_distance": f"{avg_recency:.1f}" if avg_recency >= 0 else "N/A",
            "avg_vector_distance": f"{avg_distance:.2f}" if avg_distance >= 0 else "N/A",
            "latency_ms": f"{latency:.1f}",
            "result_count": len(results),
        })

    return results_report


def measure_dedup_potential(sim, player_id):
    """估算去重潛力：在 npc_interactions room 中找近似重複"""
    wing = f"player_{player_id}"
    try:
        # 取出所有 NPC 互動記憶
        all_results = sim.collection.get(
            where={"$and": [{"wing": wing}, {"room": "npc_interactions"}]},
            include=["documents", "embeddings"]
        )
    except Exception:
        return {"dedup_rate": "N/A", "total_npc_memories": 0}

    docs = all_results.get("documents", [])
    if len(docs) < 2:
        return {"dedup_rate": "0%", "total_npc_memories": len(docs)}

    # 用每個文檔搜索自己，看有多少近似匹配
    dedup_count = 0
    sample_size = min(len(docs), 50)  # 取樣 50 個
    sampled = random.sample(range(len(docs)), sample_size)

    for idx in sampled:
        results = sim.collection.query(
            query_texts=[docs[idx]],
            n_results=3,
            where={"$and": [{"wing": wing}, {"room": "npc_interactions"}]}
        )
        dists = results.get("distances", [[]])[0]
        # 排除自己（distance=0），看是否有其他近似匹配
        near_dupes = sum(1 for d in dists[1:] if d < 0.3)  # L2 < 0.3 ≈ cosine > 0.85
        if near_dupes > 0:
            dedup_count += 1

    return {
        "dedup_rate": f"{dedup_count/sample_size:.0%}",
        "total_npc_memories": len(docs),
        "sampled": sample_size,
        "near_duplicates_found": dedup_count,
    }


def estimate_token_usage(context_str):
    """估算 token 數（中文約 1 字 = 0.5-0.7 token）"""
    if not context_str:
        return 0
    # 粗估：中文字元 * 0.6 + 英數 * 0.25
    cn_chars = sum(1 for c in context_str if '\u4e00' <= c <= '\u9fff')
    other_chars = len(context_str) - cn_chars
    return int(cn_chars * 0.6 + other_chars * 0.25)


# ─── 主測試流程 ─────────────────────────────────────────

def run_simulation():
    test_dir = os.path.join(os.path.dirname(__file__), "_mempalace_sim_data")

    # 清理舊資料
    if os.path.exists(test_dir):
        shutil.rmtree(test_dir)

    sim = MemPalaceSimulator(test_dir)
    player_id = "sim_test_001"
    round_history = []

    milestones = [10, 30, 50, 80, 100]
    milestone_reports = {}

    print("=" * 70)
    print("  MemPalace 100 回合記憶模擬測試")
    print("  Embedding: all-MiniLM-L6-v2 (ChromaDB 預設)")
    print("  Distance: L2 (Euclidean)")
    print("=" * 70)
    print()

    total_start = time.time()

    for round_num in range(1, 101):
        rd = generate_round_data(round_num)
        round_history.append(rd)

        # 寫入記憶
        sim.save_round_memory(player_id, rd, rd["story"])

        # 在里程碑回合進行測試
        if round_num in milestones:
            stats = sim.get_stats()
            print(f"── 第 {round_num} 回合測試 ──────────────────────────────")
            print(f"  記憶筆數: {stats['docs']} | KG 事實: {stats['facts']}")

            # 搜索品質測試
            quality = measure_search_quality(sim, player_id, round_num, round_history)
            print(f"\n  搜索品質 (Precision@5):")
            for q in quality:
                print(f"    {q['query']:12s} | P@5={q['precision_at_5']:>4s} | 平均回合距離={q['avg_round_distance']:>5s} | 向量距離={q['avg_vector_distance']:>6s} | {q['latency_ms']}ms")

            # 去重潛力
            dedup = measure_dedup_potential(sim, player_id)
            print(f"\n  去重潛力: {dedup['dedup_rate']} 的 NPC 互動記憶有近似重複 (共 {dedup['total_npc_memories']} 筆)")

            # Token 使用量
            npc_names = [rd["NPC"][0]["name"]] if rd["NPC"] else []
            context = sim.build_deep_memory_context(player_id, "尋找穿越的線索", npc_names)
            tokens = estimate_token_usage(context)
            print(f"\n  deepMemoryContext: {len(context)} chars ~ {tokens} tokens")

            # KG 事實查詢測試
            main_char_facts = sim.query_entity("主角", f"player_{player_id}")
            print(f"  主角活躍事實數: {len(main_char_facts)}")

            milestone_reports[round_num] = {
                "stats": stats,
                "quality": quality,
                "dedup": dedup,
                "token_estimate": tokens,
                "active_facts": len(main_char_facts),
            }
            print()

    total_time = time.time() - total_start

    # ─── 最終報告 ─────────────────────────────────────
    print("=" * 70)
    print("  最終報告")
    print("=" * 70)

    print(f"\n  總模擬時間: {total_time:.1f} 秒")
    print(f"\n  {'指標':<25s} | {'R10':>6s} | {'R30':>6s} | {'R50':>6s} | {'R80':>6s} | {'R100':>6s}")
    print("  " + "-" * 65)

    # 記憶筆數
    row = f"  {'記憶筆數':<23s}"
    for m in milestones:
        row += f" | {milestone_reports[m]['stats']['docs']:>6d}"
    print(row)

    # KG 事實數
    row = f"  {'KG 事實數':<22s}"
    for m in milestones:
        row += f" | {milestone_reports[m]['stats']['facts']:>6d}"
    print(row)

    # 平均 Precision
    row = f"  {'平均 Precision@5':<19s}"
    for m in milestones:
        precisions = [float(q["precision_at_5"].strip('%')) / 100 for q in milestone_reports[m]["quality"]]
        avg_p = sum(precisions) / len(precisions) if precisions else 0
        row += f" | {avg_p:>5.0%} "
    print(row)

    # Token 使用量
    row = f"  {'deepMemory tokens':<21s}"
    for m in milestones:
        row += f" | {milestone_reports[m]['token_estimate']:>6d}"
    print(row)

    # 去重率
    row = f"  {'NPC 去重潛力':<20s}"
    for m in milestones:
        row += f" | {milestone_reports[m]['dedup']['dedup_rate']:>6s}"
    print(row)

    # 主角活躍事實
    row = f"  {'主角活躍事實':<20s}"
    for m in milestones:
        row += f" | {milestone_reports[m]['active_facts']:>6d}"
    print(row)

    print()
    print("=" * 70)
    print("  問題診斷")
    print("=" * 70)

    # 分析問題
    r100 = milestone_reports[100]
    r10 = milestone_reports[10]

    # Precision 下降
    p10_avg = sum(float(q["precision_at_5"].strip('%')) for q in r10["quality"]) / len(r10["quality"])
    p100_avg = sum(float(q["precision_at_5"].strip('%')) for q in r100["quality"]) / len(r100["quality"])
    p_drop = p10_avg - p100_avg

    print(f"\n  1. 搜索精度下降: {p10_avg:.0f}% → {p100_avg:.0f}% (降幅 {p_drop:.0f}%)")
    if p_drop > 20:
        print("     ⚠️  嚴重 — 記憶增加後搜索品質大幅惡化")
    elif p_drop > 10:
        print("     ⚠️  中等 — 搜索品質有明顯下降")
    else:
        print("     ✅ 輕微 — 搜索品質尚可接受")

    # KG 膨脹
    active_facts = r100["active_facts"]
    print(f"\n  2. KG 事實膨脹: 主角有 {active_facts} 個活躍事實 (因為 located_at 不會 invalidate)")
    if active_facts > 50:
        print("     ⚠️  嚴重 — KG 事實未清理，每回合都新增 located_at 但從不 invalidate 舊的")

    # 去重
    dedup_rate_str = r100["dedup"]["dedup_rate"]
    print(f"\n  3. NPC 互動去重潛力: {dedup_rate_str}")
    if dedup_rate_str != "N/A" and int(dedup_rate_str.strip('%')) > 30:
        print("     ⚠️  高 — 大量近似重複記憶，浪費儲存和搜索品質")

    # Token
    tokens_100 = r100["token_estimate"]
    print(f"\n  4. Token 使用量: {tokens_100} tokens (第 100 回合)")
    if tokens_100 > 1000:
        print("     ⚠️  偏高 — 需要設定 token 預算上限")
    else:
        print("     ✅ 可接受")

    # 記憶總數
    total_docs = r100["stats"]["docs"]
    print(f"\n  5. 記憶總筆數: {total_docs}")
    print(f"     預估儲存: ~{total_docs * 0.5:.0f} KB (ChromaDB metadata + embeddings)")

    print()
    print("=" * 70)
    print("  模擬完成。測試資料位於: " + test_dir)
    print("  （可安全刪除）")
    print("=" * 70)

    # 清理
    try:
        shutil.rmtree(test_dir)
        print("  已自動清理測試資料。")
    except Exception:
        print("  請手動刪除測試資料夾。")


if __name__ == "__main__":
    run_simulation()
