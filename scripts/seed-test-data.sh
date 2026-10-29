#!/usr/bin/env bash
# Adds a few test projects to the app's data directory (macOS).
# Usage: close the app, run `bash scripts/seed-test-data.sh`, start the app again.
# Existing test projects (same ids) are overwritten; your own projects are left alone.
set -euo pipefail

DATA="$HOME/Library/Application Support/nl.jochem.flowapp/projects"

mkdir -p "$DATA/11111111-1111-4111-8111-111111111111/docs"
cat > "$DATA/11111111-1111-4111-8111-111111111111/project.json" <<'JSON'
{
  "id": "11111111-1111-4111-8111-111111111111",
  "name": "Timaflu",
  "description": "Information system for sales, purchasing and distribution.",
  "folders": [
    {
      "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "name": "Design",
      "parentId": null,
      "order": 1
    },
    {
      "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "name": "Database",
      "parentId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "order": 1
    }
  ],
  "order": 1,
  "updatedAt": 1793040000000
}
JSON
cat > "$DATA/11111111-1111-4111-8111-111111111111/docs/d1d1d1d1-0000-4000-8000-000000000001.json" <<'JSON'
{
  "id": "d1d1d1d1-0000-4000-8000-000000000001",
  "projectId": "11111111-1111-4111-8111-111111111111",
  "folderId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "order": 1,
  "name": "Order process",
  "updatedAt": 1793040000000,
  "content": {
    "kind": "flow",
    "data": {
      "nodes": [
        {
          "id": "n1",
          "kind": "pill",
          "x": -80,
          "y": -30,
          "w": 160,
          "h": 60,
          "text": "Order received",
          "color": "green"
        },
        {
          "id": "n2",
          "kind": "box",
          "x": -90,
          "y": 90,
          "w": 180,
          "h": 60,
          "text": "Check stock",
          "color": "white"
        },
        {
          "id": "n3",
          "kind": "diamond",
          "x": -90,
          "y": 210,
          "w": 180,
          "h": 120,
          "text": "In stock?",
          "color": "blue"
        },
        {
          "id": "n4",
          "kind": "box",
          "x": -90,
          "y": 390,
          "w": 180,
          "h": 60,
          "text": "Pick order",
          "color": "white"
        },
        {
          "id": "n5",
          "kind": "box",
          "x": 200,
          "y": 240,
          "w": 180,
          "h": 60,
          "text": "Reorder stock",
          "color": "pink"
        }
      ],
      "edges": [
        {
          "id": "e1",
          "from": "n1",
          "to": "n2"
        },
        {
          "id": "e2",
          "from": "n2",
          "to": "n3"
        },
        {
          "id": "e3",
          "from": "n3",
          "to": "n4",
          "label": "Yes"
        },
        {
          "id": "e4",
          "from": "n3",
          "to": "n5",
          "label": "No"
        }
      ],
      "camera": {
        "x": 0,
        "y": 0,
        "zoom": 1
      }
    }
  }
}
JSON
cat > "$DATA/11111111-1111-4111-8111-111111111111/docs/d2d2d2d2-0000-4000-8000-000000000002.json" <<'JSON'
{
  "id": "d2d2d2d2-0000-4000-8000-000000000002",
  "projectId": "11111111-1111-4111-8111-111111111111",
  "folderId": null,
  "order": 1,
  "name": "Notes",
  "updatedAt": 1793040000000,
  "content": {
    "kind": "text",
    "data": {
      "markdown": "Test document from the seed script."
    }
  }
}
JSON
mkdir -p "$DATA/22222222-2222-4222-8222-222222222222/docs"
cat > "$DATA/22222222-2222-4222-8222-222222222222/project.json" <<'JSON'
{
  "id": "22222222-2222-4222-8222-222222222222",
  "name": "Flow (this app)",
  "description": "",
  "folders": [],
  "order": 2,
  "updatedAt": 1793040000000
}
JSON
cat > "$DATA/22222222-2222-4222-8222-222222222222/docs/d3d3d3d3-0000-4000-8000-000000000003.json" <<'JSON'
{
  "id": "d3d3d3d3-0000-4000-8000-000000000003",
  "projectId": "22222222-2222-4222-8222-222222222222",
  "folderId": null,
  "order": 1,
  "name": "Tasks",
  "updatedAt": 1793040000000,
  "content": {
    "kind": "kanban",
    "data": {
      "columns": [
        {
          "id": "c1",
          "title": "To do",
          "cards": [
            {
              "id": "k1",
              "title": "create_project",
              "description": ""
            }
          ]
        },
        {
          "id": "c2",
          "title": "In progress",
          "cards": [
            {
              "id": "k2",
              "title": "list_projects",
              "description": ""
            }
          ]
        },
        {
          "id": "c3",
          "title": "Done",
          "cards": []
        }
      ]
    }
  }
}
JSON
mkdir -p "$DATA/33333333-3333-4333-8333-333333333333/docs"
cat > "$DATA/33333333-3333-4333-8333-333333333333/project.json" <<'JSON'
{
  "id": "33333333-3333-4333-8333-333333333333",
  "name": "Personal",
  "description": "",
  "folders": [],
  "order": 3,
  "updatedAt": 1793040000000
}
JSON

echo "Test projects created in: $DATA"
ls "$DATA"
