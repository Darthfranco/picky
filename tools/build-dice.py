"""Build Picky's tiny Platonic dice with Blender, without a runtime 3D library.

Run: /Applications/Blender.app/Contents/MacOS/Blender --background --python tools/build-dice.py
The .blend is editable source; only models.json is shipped to the PWA cache.
"""
import bpy
import bmesh
import json
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "dice"
OUTPUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)


def make_mesh(name, vertices, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def normalized(obj):
    radius = max(vertex.co.length for vertex in obj.data.vertices)
    for vertex in obj.data.vertices:
        vertex.co /= radius
    obj.data.update()
    return obj


bpy.ops.mesh.primitive_cube_add(size=2)
cube = normalized(bpy.context.object)
cube.name = "D6"

# An octahedron is the convex hull of six axis tips.
octa = make_mesh("D8", [(1, 0, 0), (-1, 0, 0), (0, 1, 0),
                        (0, -1, 0), (0, 0, 1), (0, 0, -1)], [])
bm = bmesh.new()
bm.from_mesh(octa.data)
bmesh.ops.convex_hull(bm, input=list(bm.verts))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(octa.data)
bm.free()
octa.data.update()

bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1)
icosa = normalized(bpy.context.object)
icosa.name = "D20"

# The dual of Blender's icosahedron is a regular dodecahedron.
dual_vertices = [face.center.normalized() for face in icosa.data.polygons]
dual_faces = []
for vertex in icosa.data.vertices:
    adjacent = [face.index for face in icosa.data.polygons if vertex.index in face.vertices]
    normal = vertex.co.normalized()
    axis_u = normal.cross(Vector((0, 0, 1)))
    if axis_u.length < 0.01:
        axis_u = normal.cross(Vector((0, 1, 0)))
    axis_u.normalize()
    axis_v = normal.cross(axis_u).normalized()
    adjacent.sort(key=lambda i: math.atan2(dual_vertices[i].dot(axis_v), dual_vertices[i].dot(axis_u)))
    dual_faces.append(adjacent)
dodeca = normalized(make_mesh("D12", dual_vertices, dual_faces))

material = bpy.data.materials.new("Picky cream")
material.diffuse_color = (0.93, 0.86, 0.67, 1)
models = {}
for index, (sides, obj) in enumerate([(6, cube), (8, octa), (12, dodeca), (20, icosa)]):
    obj.data.materials.append(material)
    faces = list(obj.data.polygons)
    labels = [0] * sides
    next_label = 1
    # Opposite faces always sum to N + 1, as on physical dice.
    for face in faces:
        if labels[face.index]:
            continue
        opposite = min(faces, key=lambda other: face.normal.dot(other.normal))
        labels[face.index] = next_label
        labels[opposite.index] = sides + 1 - next_label
        next_label += 1
    assert sorted(labels) == list(range(1, sides + 1))
    models[str(sides)] = {
        "vertices": [[round(value, 6) for value in vertex.co] for vertex in obj.data.vertices],
        "faces": [list(face.vertices) for face in faces],
        "labels": labels,
    }
    # Keep the editable objects separate in the authoring scene.
    obj.location.x = (index - 1.5) * 2.7
    obj["face_values"] = labels
    obj["runtime_asset"] = "models.json"

payload = {"generator": "Blender " + bpy.app.version_string, "models": models}
(OUTPUT / "models.json").write_text(json.dumps(payload, separators=(",", ":")) + "\n")
bpy.context.scene.world.color = (0.025, 0.025, 0.025)
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT / "picky-dice.blend"), compress=True)
print("Picky dice exported:", OUTPUT / "models.json")
print("Runtime geometry bytes:", (OUTPUT / "models.json").stat().st_size)
