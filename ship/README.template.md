# VESPER Explorer — игровой ассет (98.4 × 32.7 × 21.3 м)

Модель исследовательского корабля по референсу «VESPER Explorer»: гранёный корпус с камуфляжем из реальных панелей,
кабина с остеклением, двигательные гондолы, антенный модуль и **полный интерьер на трёх палубах**
(мостик, каюты, медотсек, реактор, трюм и т. д.). Сделано для Unity и Blender.

## Что в папке `export/`

| Файл | Для чего |
|---|---|
| `Vesper_Explorer.glb` | Основной файл, всё внутри (геометрия, PBR-материалы, текстуры, источники света). Blender, Unity (glTFast), Godot, Unreal |
| `Vesper_Explorer.fbx` + `Textures/` | FBX для Unity без плагинов. Текстуры лежат рядом по относительным путям |
| `Vesper_Explorer.blend` | Сцена Blender 5.0 с иерархией по коллекциям. Текстуры подключены из `Textures/` |
| `Vesper_Explorer_Colliders.glb/.fbx` | Упрощённые коллайдеры: `COL_Hull`, `COL_Interior_Structure` (стены и полы), `COL_Interior_Furniture` |
| `Unity/Editor/VesperExplorerImporter.cs` | Авто-настройка импорта FBX в Unity (материалы Standard/URP, коллайдеры, двери) |
| `Unity/Runtime/VesperSlidingDoor.cs` | Компонент раздвижной двери (створки разъезжаются при приближении камеры/игрока) |
| `Unity/Vesper_Materials.json` | Таблица материалов: цвета, факторы, карты |
| `Previews/` | Контрольные рендеры из Blender (Cycles) |

## Характеристики

- Единицы: **метры**, масштаб 1:1. Нос смотрит в **+Z** (конвенция glTF), верх **+Y**. В Blender нос смотрит в −Y, в Unity — в +Z.
- Треугольников: **{{TRIS}}** (экстерьер {{EXT}}, интерьер {{INT}}, двери {{DOORS_TRIS}}).
- Иерархия: `Exterior/` (Hull_Upper, Hull_Sides, Hull_Lower, Hull_Front, Cockpit, Antenna_Module, Engine_Pod_L/R, Engines_Main, Hull_Details, Decals, Nav_Lights, Windows_Glass) ·
  `Interior/Deck_A_Command`, `Deck_B_Living`, `Deck_C_Engineering` → по узлу на отсек (`A-12_Command_Bridge`, `B-02_Medical_Bay` …) ·
  `Doors/` ({{DOORS}} дверей, у каждой створки `Leaf_L` / `Leaf_R`) · `Lights/` ({{LIGHTS}} точечных источников).
- Отсеков: {{ROOMS}}, окон: {{WINDOWS}}. Окна настоящие: проём в стене, откосы до обшивки, стекло. Снаружи видно освещённый интерьер, изнутри — космос.
- Материалы: {{MATERIALS}} (PBR metal/rough), на {{SETS}} наборах текстур. Тайловые текстуры с UV в метрах мира, поэтому плотность текселей одинаковая по всему кораблю.
  Набор на материал: `BaseColor`, `ORM` (R = AO, G = Roughness, B = Metallic; стандарт glTF), `Normal` (OpenGL, +Y), `MaskMap` (для Unity: R = Metallic, G = AO, A = Smoothness), при необходимости `Emission`.
  Корпус: 2048², интерьер: 512–1024². Атласы: логотип и маркировка (`Decals`), экраны (`Screens`), таблички отсеков (`Signs`).
- Двери: у узлов `Door_*` есть свойства (glTF extras / FBX user properties) `type = sliding_door`, `openDistance`, `slideAxis`, `room`.

## Blender

Откройте `Vesper_Explorer.blend`. Другой вариант: *File → Import → glTF 2.0* и выбрать `Vesper_Explorer.glb`.
Коллекции `Exterior`, `Interior`, `Doors`, `Lights` удобно скрывать по отдельности. Для рендера изнутри включите коллекцию `Lights`.

## Unity

**Вариант 1 — рекомендуемый (GLB, все пайплайны, включая HDRP).**
1. *Window → Package Manager → + → Add package by name…* → `com.unity.cloud.gltfast`.
2. Перетащите `Vesper_Explorer.glb` в `Assets/`. Материалы, текстуры, источники света и emission подтянутся автоматически.

**Вариант 2 — FBX без плагинов (Built-in или URP).**
1. Скопируйте в `Assets/VesperExplorer/` файлы `Vesper_Explorer.fbx`, `Vesper_Explorer_Colliders.fbx`, папку `Textures/` и папку `Unity/`.
   Не кладите `.blend` в `Assets` — Unity попытается импортировать его через установленный Blender.
2. Скрипт `VesperExplorerImporter` при импорте сам создаст материалы (Standard или URP/Lit — по активному пайплайну),
   выставит normal map и линейные маски, повесит `VesperSlidingDoor` на двери, а `MeshCollider` — на объекты `COL_*`.
3. Если материалы пришли без текстур (такое бывает, когда текстуры импортируются позже модели), выполните *Tools → VESPER Explorer → Reimport models*.
4. Для запечённого света включите в импортёре модели *Generate Lightmap UVs*. {{LIGHTS}} точечных источников рассчитаны на запекание (Baked/Mixed), а не на realtime.

## Пересборка из исходников

Модель и текстуры полностью процедурные (Node.js + three.js + glTF-Transform, конвертация через `bpy`):

```bash
cd ship
npm install
npm run textures   # PBR-текстуры → build/Textures
npm run build      # геометрия → export/*.glb, build/gltf/*.gltf, Unity/Vesper_Materials.json
npm run blender    # .blend + .fbx (нужен uv; ставит bpy для Python 3.11)
uv run --python 3.11 --with bpy python blender/convert.py --only-render   # превью-рендеры
```
