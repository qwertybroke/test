// Раздвижная дверь VESPER Explorer: створки Leaf_L / Leaf_R разъезжаются, когда цель (по умолчанию Camera.main) рядом.
using UnityEngine;

namespace Vesper
{
    public class VesperSlidingDoor : MonoBehaviour
    {
        public Transform leafL, leafR;
        public float openDistance = 0.66f;
        public float triggerRadius = 2.4f;
        public float speed = 2.5f;
        [Tooltip("Кто открывает дверь. Пусто — Camera.main")]
        public Transform target;
        [Range(0, 1)] public float openAmount;
        public bool forceOpen;

        Vector3 l0, r0, axis;

        void Start()
        {
            if (!leafL) leafL = FindLeaf("Leaf_L");
            if (!leafR) leafR = FindLeaf("Leaf_R");
            if (!leafL || !leafR) { enabled = false; return; }
            l0 = leafL.localPosition; r0 = leafR.localPosition;
            axis = (r0 - l0).sqrMagnitude > 1e-6f ? (r0 - l0).normalized : Vector3.right;
        }

        // Створки называются «Door_X_Leaf_L» / «Door_X_Leaf_R» (имена в сцене уникальны), допускаются и просто «Leaf_L».
        Transform FindLeaf(string suffix)
        {
            foreach (Transform c in transform)
            {
                var n = c.name;
                int dot = n.LastIndexOf('.');
                if (dot > 0 && int.TryParse(n.Substring(dot + 1), out _)) n = n.Substring(0, dot);
                if (n.EndsWith(suffix, System.StringComparison.Ordinal)) return c;
            }
            return null;
        }

        void Update()
        {
            var t = target ? target : (Camera.main ? Camera.main.transform : null);
            bool open = forceOpen || (t && (t.position - transform.position).sqrMagnitude < triggerRadius * triggerRadius);
            openAmount = Mathf.MoveTowards(openAmount, open ? 1f : 0f, Time.deltaTime * speed);
            var off = axis * (openDistance * Mathf.SmoothStep(0f, 1f, openAmount));
            leafL.localPosition = l0 - off;
            leafR.localPosition = r0 + off;
        }
    }
}
