---
tool: map_service
method: batch_create_locations
description: "批量创建地点（先创建所有地点，再统一建立连接关系，解决地点间互相引用的顺序依赖问题）"
paramTypes:
  locations: "array<object{locationLevel:number,name:string,description:string,type:string,x:number,y:number,terrainType:string,dangerLevel:number,visible:boolean,connections:string,events:string,parentLocationId:string}> (required) - 要创建的地点列表。支持地点间互相引用连接名称，无需关心创建顺序（如A连接B、B连接A可同时传入）"
since: "2.0"
---

# map_service.batch_create_locations

<!-- @manual: 本文件 frontmatter 由 generate-agent-help 自动维护，正文由人工维护 -->
<!-- 如需完全手工维护 frontmatter，在正文任意处添加 <!-- @manual-frontmatter --> 标记 -->

## 功能
批量创建地点（先创建所有地点，再统一建立连接关系，解决地点间互相引用的顺序依赖问题）

## 参数详解
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| locations | array<object{locationLevel:number,name:string,description:string,type:string,x:number,y:number,terrainType:string,dangerLevel:number,visible:boolean,connections:string,events:string,parentLocationId:string}> | 是 | 要创建的地点列表。支持地点间互相引用连接名称，无需关心创建顺序（如A连接B、B连接A可同时传入） |

## 返回值
（待补充）

## 注意事项
（待补充）
