/**
 * 自检脚本：抽出 index.html 里的纯逻辑代码，在 Node 中跑解析/同步相关单测。
 * 用法：node ../_selftest/run.mjs  （或 node _selftest/run.mjs，路径随意）
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, '..', 'index.html'), 'utf8');

// 取最后一个内联 <script> 块（CDN 的带 src，不会匹配）
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!blocks.length) throw new Error('没有找到内联脚本');
let code = blocks[blocks.length - 1];

// 截掉 DOM 绑定与启动部分（第 14 节之后）
const cut = code.indexOf('/* ---------------- 14.');
if (cut < 0) throw new Error('没有找到第 14 节标记');
code = code.slice(0, cut) + '\nreturn { parsePasteText, parseICS, expandWeeks, weeksToSpec, normalizeCourse, diffCourses, planMerge, applyMerge, snapshotSig, courseSig, extractCourseBlocks, WEEK_NODE_RE, QR, state, rowByKey, nodeToRow, termStartMonday, shortCode, makePairCode };\n';

// 浏览器环境的极简桩
const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
const document = { querySelector: () => null, querySelectorAll: () => [] };

const api = new Function('localStorage', 'document', 'window', code)(localStorage, document, {});

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n     got :', g, '\n     want:', w); }
};

console.log('\n[1] 周次解析');
eq('1-16周(单)', api.expandWeeks('1-16周(单)'), [1, 3, 5, 7, 9, 11, 13, 15]);
eq('第3-15周(双)', api.expandWeeks('第3-15周(双)'), [4, 6, 8, 10, 12, 14]);
eq('1,3,5,7', api.expandWeeks('1,3,5,7'), [1, 3, 5, 7]);
eq('weeksToSpec 等差', api.weeksToSpec([1, 3, 5, 7, 9, 11, 13, 15]), '1-15单');
eq('weeksToSpec 连续', api.weeksToSpec([1, 2, 3, 4]), '1-4');
eq('weeksToSpec 离散', api.weeksToSpec([1, 3, 9]), '1,3,9');

console.log('\n[2] 节次映射');
eq('第10节→9-10', api.nodeToRow(10), '9-10');
eq('第12节→11-12', api.nodeToRow(12), '11-12');
eq('第3节→3', api.nodeToRow(3), '3');
eq('9-10节时间', api.rowByKey('9-10').start + '-' + api.rowByKey('9-10').end, '18:30-20:00');
eq('11-12节时间', api.rowByKey('11-12').start + '-' + api.rowByKey('11-12').end, '20:10-21:40');
eq('预备铃', api.rowByKey('1').bell, '08:10');

console.log('\n[3] 粘贴文本解析 · 一行一课');
const t1 = api.parsePasteText('高等数学A(1) 周一 第1-2节 1-16周 J06-101 张伟\n大学英语(一) 周二 第3-4节 {1-16周} J06A108 李娜');
eq('课程数', t1.length, 2);
eq('第1门名称', t1[0].name, '高等数学A(1)');
eq('第1门教室', t1[0].room, 'J06-101');
eq('第1门教师', t1[0].teacher, '张伟');
eq('第1门星期/节次', [t1[0].day, t1[0].start, t1[0].end], [1, '1', '2']);
eq('第1门周次', t1[0].weeks, '1-16');
eq('第2门教室', t1[1].room, 'J06A108');

console.log('\n[4] 粘贴文本解析 · 多行块');
const t2 = api.parsePasteText('大学英语\n周二 第3-4节 {1-16周}\nJ06A101\n李四\n\n大学物理\n周三 第5-6节 (1-16周)\nJ06-203\n王强');
eq('课程数', t2.length, 2);
eq('课程名', t2.map(c => c.name), ['大学英语', '大学物理']);
eq('教室', t2.map(c => c.room), ['J06A101', 'J06-203']);
eq('教师', t2.map(c => c.teacher), ['李四', '王强']);
eq('节次', t2.map(c => c.start + '-' + c.end), ['3-4', '5-6']);

console.log('\n[5] ICS 解析（RRULE COUNT / UNTIL / EXDATE）');
api.state.settings.termStart = '2026-03-02';   // 第一周周一
const ics = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'SUMMARY:思想政治理论',
  'LOCATION:J06-802',
  'DESCRIPTION:马克思主义学院 张老师',
  'DTSTART:20260302T082000',
  'DTEND:20260302T090500',
  'RRULE:FREQ=WEEKLY;COUNT=16',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'SUMMARY:大学体育(三)',
  'LOCATION:体育馆',
  'DTSTART:20260305T140000',
  'DTEND:20260305T153500',
  'RRULE:FREQ=WEEKLY;UNTIL=20260619T000000',
  'EXDATE:20260402T140000',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');
const ics1 = api.parseICS(ics);
eq('课程数', ics1.courses.length, 2);
eq('推断开学日', ics1.termStart, '2026-03-02');
eq('第1门名称', ics1.courses[0].name, '思想政治理论');
eq('第1门星期/节次', [ics1.courses[0].day, ics1.courses[0].start], [1, '1']);
eq('第1门周次(COUNT=16)', ics1.courses[0].weeks, '1-16');
eq('第2门星期/节次(14:00→第5节)', [ics1.courses[1].day, ics1.courses[1].start, ics1.courses[1].end], [4, '5', '6']);
console.log('    （第2门周次实测：' + ics1.courses[1].weeks + '）');

console.log('\n[6] 差异比对（用于生成变更摘要）');
const base = [
  { id: 'a', name: '高数', day: 1, start: '1', end: '2', weeks: '1-16', room: 'A', teacher: '' },
  { id: 'b', name: '英语', day: 2, start: '3', end: '4', weeks: '1-16', room: 'B', teacher: '' }
];
const incoming = [
  { id: 'a', name: '高数', day: 1, start: '1', end: '2', weeks: '1-16', room: 'A101', teacher: '' },   // 改
  { id: 'c', name: '物理', day: 3, start: '5', end: '6', weeks: '1-16', room: 'C', teacher: '' }        // 增
];
const d = api.diffCourses(base, incoming);
eq('新增数', d.added.length, 1);
eq('修改数', d.updated.length, 1);
eq('删除数', d.removed.length, 1);
eq('删除的是英语', d.removed[0].name, '英语');

console.log('\n[7] 合并方案 planMerge（首次同步 / 冲突 / 保留本地）');
const C = (id, name, room, weeks) => api.normalizeCourse({ id, name, day: 1, start: '1', end: '2', weeks: weeks || '1-16', room }, 'partner');
// 7.1 首次同步（base = null）：对方内容全部生效，不产生冲突
const local0 = [C('a', '高数', 'A'), C('b', '英语', 'B')];
const remote0 = [C('a', '高数', 'A101'), C('c', '物理', 'C')];
let plan = api.planMerge(local0, remote0, null);
eq('首次同步-修改', plan.updated.length, 1);
eq('首次同步-新增', plan.added.length, 1);
eq('首次同步-删除', plan.removed.length, 1);
eq('首次同步-无冲突', plan.conflicts.length, 0);

// 7.2 同步过一次后：我改了课，对方没改 → 保留我的（不覆盖、不报冲突）
const baseSig = api.snapshotSig(remote0);                 // 上次同步时对方的课表
const local1 = [C('a', '高数', '我改的教室'), C('c', '物理', 'C')];
plan = api.planMerge(local1, remote0, baseSig);
eq('只有我改 → 保留我的', plan.kept.length, 1);
eq('只有我改 → 不覆盖', plan.updated.length, 0);
eq('只有我改 → 无冲突', plan.conflicts.length, 0);

// 7.3 两边都改了同一门课 → 冲突，交给用户逐条决定
const remote1 = [C('a', '高数', 'TA改的教室'), C('c', '物理', 'C')];
plan = api.planMerge(local1, remote1, baseSig);
eq('两边都改 → 冲突 1 条', plan.conflicts.length, 1);
eq('冲突类型为 update', plan.conflicts[0].type, 'update');
// 用对方的
api.state.partner = JSON.parse(JSON.stringify(local1));
api.state.mine = [C('m', '我的课', 'X')];
api.applyMerge(plan, { 0: 'remote' });
eq('选“用 TA 的”后取对方值', api.state.partner.find(c => c.id === 'a').room, 'TA改的教室');
// 保留我的
api.state.partner = JSON.parse(JSON.stringify(local1));
api.applyMerge(plan, { 0: 'local' });
eq('选“保留我的”后不变', api.state.partner.find(c => c.id === 'a').room, '我改的教室');
eq('我方课表始终不动', api.state.mine.map(c => c.name), ['我的课']);

// 7.4 我本地新增的课（base 里没有）不能被对方"顺手删掉"
const local2 = local1.concat([C('z', '我加的选修', 'Z')]);
plan = api.planMerge(local2, remote0, baseSig);
eq('本地新增的课被保留', plan.kept.some(c => c.id === 'z'), true);
eq('本地新增的课不被删除', plan.removed.some(c => c.id === 'z'), false);

// 7.5 对方删了课：我没动过 → 正常删除；我本地改过 → 删除冲突
const baseM2 = api.snapshotSig([C('a', '高数', 'A101'), C('b', '英语', 'B'), C('c', '物理', 'C')]);
const remote2 = [C('a', '高数', 'A101'), C('c', '物理', 'C')];      // 对方删掉了「英语」
let planR = api.planMerge([C('a', '高数', 'A101'), C('b', '英语', 'B')], remote2, baseM2);
eq('未改过的课被正常删除', planR.removed.some(c => c.id === 'b'), true);
eq('未改过的课不算冲突', planR.conflicts.length, 0);
planR = api.planMerge([C('a', '高数', 'A101'), C('b', '英语', '我改过')], remote2, baseM2);
eq('对方删除+我改过 → 冲突', planR.conflicts.filter(c => c.type === 'remove').length, 1);
eq('冲突时不直接删掉', planR.removed.some(c => c.id === 'b'), false);
// 选择"用 TA 的"才真正删除
api.state.partner = [C('a', '高数', 'A101'), C('b', '英语', '我改过')];
api.applyMerge(planR, { 0: 'remote' });
eq('选“用 TA 的”后执行删除', api.state.partner.some(c => c.id === 'b'), false);
// 选择"保留我的"则不删
api.state.partner = [C('a', '高数', 'A101'), C('b', '英语', '我改过')];
api.applyMerge(planR, { 0: 'local' });
eq('选“保留我的”后课还在', api.state.partner.some(c => c.id === 'b'), true);

// 7.6 内容完全相同的课不会因为 id 不同而重复添加
const local4 = [C('a', '高数', 'A'), C('b', '英语', 'B')];
plan = api.planMerge(local4, [C('a', '高数', 'A'), C('new-id', '英语', 'B')], null);
eq('同内容不同 id 视为同一门课', plan.added.length, 0);

console.log('\n[8] 配对密钥');
const code1 = api.makePairCode();
eq('密钥格式', /^LOVE-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code1), true);
eq('短码长度', api.shortCode(code1).length, 6);
eq('同一密钥短码稳定', api.shortCode('love-abcd-1234') === api.shortCode('LOVEABCD1234'), true);

console.log('\n[9] QR 编码器（结构自检，逐位对拍见 qr-crosscheck.mjs）');
const qr = api.QR.encode('https://example.com/情侣课表');
eq('版本与尺寸匹配', qr.size % 4, 1);
eq('定位图形左上角为黑', qr.get(0, 0) === true, true);
eq('分隔符为白', qr.get(7, 7) === false, true);
eq('定时图形交替', qr.get(8, 6) === true && qr.get(9, 6) === false, true);
eq('固定暗模块', qr.get(8, qr.size - 8) === true, true);

console.log('\n[10] 教务表格解析：周次[节次] 锚点（真实 .xls 结构）');
const ex1 = api.extractCourseBlocks(['实用数值方法', '冯艳华', '4,6-11[1-2]', 'J33B102']);
eq('单门课-数量', ex1.length, 1);
eq('单门课-周次(逗号开头)', ex1[0].weeks, '4,6-11');
eq('单门课-节次', [ex1[0].s, ex1[0].e], [1, 2]);
eq('单门课-教室', ex1[0].room, 'J33B102');
eq('单门课-教师', ex1[0].teacher, '冯艳华');
const ex2 = api.extractCourseBlocks(['概率论与数理统计（理）', '赵维胜', '1-4,6-13[3-4]', 'J33B104']);
eq('周次以区间开头 1-4,6-13', ex2[0].weeks, '1-4,6-13');
const ex3 = api.extractCourseBlocks(['电工学1', '王少愚', '16[1-4]', 'J07-101☆']);
eq('单周 16 + 连堂 1-4', [ex3[0].weeks, ex3[0].s, ex3[0].e], ['16', 1, 4]);
eq('教室末尾符号被清理', ex3[0].room, 'J07-101');
const ex4 = api.extractCourseBlocks(['形势与政策3', '毛文君', '13[9-12]', 'J05A108']);
eq('9-12 节 → 跨 9-10 与 11-12', [ex4[0].s, ex4[0].e], [9, 12]);
eq('9-12 起始行', api.nodeToRow(ex4[0].s) + '~' + api.nodeToRow(ex4[0].e), '9-10~11-12');
const ex5 = api.extractCourseBlocks(['大学物理', '王强', '1-4,6-9[1-2]', 'J05A301', '电工学1', '王少愚', '16[1-4]', 'J07-103']);
eq('一格两门课', ex5.map(c => c.name), ['大学物理', '电工学1']);
eq('第二门教室', ex5[1].room, 'J07-103');
const ex6 = api.extractCourseBlocks(['体育专项Ⅰ', '陈跃坤', '1-4,6-17[9-10]', '小球馆二楼羽毛球室-2']);
eq('中文教室', ex6[0].room, '小球馆二楼羽毛球室-2');
eq('无锚点行不产生课程', api.extractCourseBlocks(['上午', '一', '中午']).length, 0);
eq('锚点正则不吃"第1-2节"式无周次文本', api.WEEK_NODE_RE.test('第1-2节'), false);

console.log('\n结果：通过 ' + pass + ' 项，失败 ' + fail + ' 项\n');
process.exit(fail ? 1 : 0);
