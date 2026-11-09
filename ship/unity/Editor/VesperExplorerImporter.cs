#if UNITY_EDITOR
// Импорт VESPER Explorer (FBX) в Unity: материалы Standard / URP Lit из Vesper_Materials.json,
// настройки текстур, коллайдеры (Vesper_Explorer_Colliders.fbx) и раздвижные двери.
// Положите папку ассета целиком в Assets/ (например Assets/VesperExplorer/), без .blend-файла.
using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.AssetImporters;
using UnityEngine;
using UnityEngine.Rendering;

namespace Vesper.EditorTools
{
    [Serializable] class MatDef
    {
        public string name, set, alphaMode, baseMap, normalMap, maskMap, emissionMap;
        public float[] baseColor, emission;
        public float metallic, roughness, emissionStrength;
        public bool doubleSided;
    }
    [Serializable] class MatTable { public MatDef[] materials; }

    public class VesperExplorerImporter : AssetPostprocessor
    {
        const string Key = "Vesper_Explorer";

        static bool IsOurs(string path) => Path.GetFileName(path).StartsWith(Key, StringComparison.Ordinal);
        static string Dir(string path) => Path.GetDirectoryName(path).Replace('\\', '/');

        static Dictionary<string, MatDef> LoadTable(string modelPath)
        {
            string json = Dir(modelPath) + "/Unity/Vesper_Materials.json";
            if (!File.Exists(json)) { Debug.LogWarning("[VESPER] Не найден " + json); return null; }
            var t = JsonUtility.FromJson<MatTable>(File.ReadAllText(json));
            var d = new Dictionary<string, MatDef>();
            foreach (var m in t.materials) d[m.name] = m;
            return d;
        }

        void OnPreprocessModel()
        {
            if (!IsOurs(assetPath)) return;
            var mi = (ModelImporter)assetImporter;
            mi.materialImportMode = ModelImporterMaterialImportMode.ImportViaMaterialDescription;
            mi.importLights = true;
            mi.importCameras = false;
            mi.useFileScale = true;
            mi.importNormals = ModelImporterNormals.Import;
            mi.importAnimation = false;
        }

        void OnPreprocessTexture()
        {
            var name = Path.GetFileNameWithoutExtension(assetPath);
            if (!name.StartsWith("T_", StringComparison.Ordinal) || !File.Exists(Dir(assetPath) + "/../" + Key + ".fbx")) return;
            var ti = (TextureImporter)assetImporter;
            if (name.EndsWith("_Normal")) ti.textureType = TextureImporterType.NormalMap;
            else if (name.EndsWith("_MaskMap") || name.EndsWith("_ORM")) ti.sRGBTexture = false;
            ti.anisoLevel = 8;
            ti.mipmapEnabled = true;
        }

        void OnPreprocessMaterialDescription(MaterialDescription description, Material material, AnimationClip[] animations)
        {
            if (!IsOurs(assetPath)) return;
            var table = LoadTable(assetPath);
            if (table == null || !table.TryGetValue(description.materialName, out var d)) return;
            var rp = GraphicsSettings.currentRenderPipeline;
            bool urp = rp != null && rp.GetType().Name.Contains("Universal");
            var shader = urp ? Shader.Find("Universal Render Pipeline/Lit") : Shader.Find("Standard");
            if (shader == null) { Debug.LogWarning("[VESPER] Шейдер не найден (HDRP? используйте GLB + glTFast)"); return; }
            material.shader = shader;

            string texDir = Dir(assetPath) + "/Textures/";
            Texture2D Tex(string f)
            {
                if (string.IsNullOrEmpty(f)) return null;
                var p = texDir + f;
                context.DependsOnSourceAsset(p);
                return AssetDatabase.LoadAssetAtPath<Texture2D>(p);
            }
            var baseTex = Tex(d.baseMap); var nrm = Tex(d.normalMap); var mask = Tex(d.maskMap); var emi = Tex(d.emissionMap);
            var col = new Color(d.baseColor[0], d.baseColor[1], d.baseColor[2], d.baseColor[3]);
            var emCol = new Color(d.emission[0], d.emission[1], d.emission[2]) * Mathf.Max(d.emissionStrength, 1f);
            bool emissive = d.emissionStrength > 0f;

            if (urp)
            {
                material.SetColor("_BaseColor", col);
                if (baseTex) material.SetTexture("_BaseMap", baseTex);
                material.SetFloat("_Metallic", d.metallic);
                material.SetFloat("_Smoothness", mask ? 1f : 1f - d.roughness);
                if (mask) { material.SetTexture("_MetallicGlossMap", mask); material.EnableKeyword("_METALLICSPECGLOSSMAP"); material.SetTexture("_OcclusionMap", mask); material.EnableKeyword("_OCCLUSIONMAP"); }
                if (nrm) { material.SetTexture("_BumpMap", nrm); material.EnableKeyword("_NORMALMAP"); }
                if (emissive) { material.SetColor("_EmissionColor", emCol); if (emi) material.SetTexture("_EmissionMap", emi); material.EnableKeyword("_EMISSION"); material.globalIlluminationFlags = MaterialGlobalIlluminationFlags.BakedEmissive; }
                if (d.doubleSided) material.SetFloat("_Cull", 0f);
                if (d.alphaMode == "BLEND")
                {
                    material.SetFloat("_Surface", 1f); material.SetFloat("_Blend", 0f);
                    material.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha); material.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
                    material.SetFloat("_ZWrite", 0f); material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                    material.SetOverrideTag("RenderType", "Transparent"); material.renderQueue = (int)RenderQueue.Transparent;
                }
                else if (d.alphaMode == "MASK")
                {
                    material.SetFloat("_AlphaClip", 1f); material.SetFloat("_Cutoff", 0.5f); material.EnableKeyword("_ALPHATEST_ON");
                    material.SetOverrideTag("RenderType", "TransparentCutout"); material.renderQueue = (int)RenderQueue.AlphaTest;
                }
            }
            else
            {
                material.SetColor("_Color", col);
                if (baseTex) material.SetTexture("_MainTex", baseTex);
                material.SetFloat("_Metallic", d.metallic);
                material.SetFloat("_Glossiness", 1f - d.roughness);
                if (mask) { material.SetTexture("_MetallicGlossMap", mask); material.SetFloat("_GlossMapScale", 1f); material.EnableKeyword("_METALLICGLOSSMAP"); material.SetTexture("_OcclusionMap", mask); }
                if (nrm) { material.SetTexture("_BumpMap", nrm); material.EnableKeyword("_NORMALMAP"); }
                if (emissive) { material.SetColor("_EmissionColor", emCol); if (emi) material.SetTexture("_EmissionMap", emi); material.EnableKeyword("_EMISSION"); material.globalIlluminationFlags = MaterialGlobalIlluminationFlags.BakedEmissive; }
                if (d.alphaMode == "BLEND")
                {
                    material.SetFloat("_Mode", 3f); material.SetInt("_SrcBlend", (int)BlendMode.One); material.SetInt("_DstBlend", (int)BlendMode.OneMinusSrcAlpha);
                    material.SetInt("_ZWrite", 0); material.EnableKeyword("_ALPHAPREMULTIPLY_ON");
                    material.SetOverrideTag("RenderType", "Transparent"); material.renderQueue = (int)RenderQueue.Transparent;
                }
                else if (d.alphaMode == "MASK")
                {
                    material.SetFloat("_Mode", 1f); material.SetFloat("_Cutoff", 0.5f); material.EnableKeyword("_ALPHATEST_ON");
                    material.SetOverrideTag("RenderType", "TransparentCutout"); material.renderQueue = (int)RenderQueue.AlphaTest;
                }
            }
        }

        // Двери: custom-свойство type = sliding_door → компонент VesperSlidingDoor
        void OnPostprocessGameObjectWithUserProperties(GameObject go, string[] names, object[] values)
        {
            if (!IsOurs(assetPath)) return;
            int ti = Array.IndexOf(names, "type");
            if (ti < 0 || !(values[ti] is string s) || s != "sliding_door") return;
            var door = go.AddComponent<Vesper.VesperSlidingDoor>();
            int oi = Array.IndexOf(names, "openDistance");
            if (oi >= 0) door.openDistance = Convert.ToSingle(values[oi]);
        }

        // Коллайдеры: меши COL_* → MeshCollider без рендера
        void OnPostprocessModel(GameObject root)
        {
            if (!Path.GetFileName(assetPath).StartsWith(Key + "_Colliders", StringComparison.Ordinal)) return;
            foreach (var mf in root.GetComponentsInChildren<MeshFilter>(true))
            {
                if (!mf.name.StartsWith("COL_", StringComparison.Ordinal)) continue;
                var mc = mf.gameObject.AddComponent<MeshCollider>();
                mc.sharedMesh = mf.sharedMesh;
                var mr = mf.GetComponent<MeshRenderer>();
                if (mr) UnityEngine.Object.DestroyImmediate(mr);
            }
        }
    }
}
#endif
