"""
ws_manager.py — Centralized WebSocket Connection Manager for NotePay
Handles active WebSocket connections across serverless AWS API Gateway (Redis/Boto3) and local development (FastAPI WebSockets).
"""
import os
import json
import boto3
import concurrent.futures
from typing import Dict, List
from fastapi import WebSocket

try:
    from cache import cache
except ImportError:
    cache = None

apigw_client = None


class ConnectionManager:
    def __init__(self):
        # Maps event_id -> list of active WebSocket connections
        self.active_connections: Dict[str, List[WebSocket]] = {}
        # Connections listening to dashboard/system-wide changes
        self.dashboard_connections: List[WebSocket] = []

    def register(self, websocket: WebSocket, event_id: str):
        if event_id not in self.active_connections:
            self.active_connections[event_id] = []
        self.active_connections[event_id].append(websocket)

    def disconnect(self, websocket: WebSocket, event_id: str):
        if event_id in self.active_connections:
            if websocket in self.active_connections[event_id]:
                self.active_connections[event_id].remove(websocket)
            if not self.active_connections[event_id]:
                del self.active_connections[event_id]

    async def broadcast_change(self, event_id: str, message: dict):
        if os.getenv("ENVIRONMENT") == "production" and cache and cache.client:
            # Serverless AWS API Gateway Broadcast
            conns = cache.client.smembers(f"ws:evt:{event_id}")
            if conns:
                try:
                    global apigw_client
                    if apigw_client is None:
                        endpoint = os.getenv("WEBSOCKET_URL", "").replace("wss://", "https://")
                        apigw_client = boto3.client('apigatewaymanagementapi', endpoint_url=endpoint)
                    
                    msg_str = json.dumps(message)
                    dead = []
                    
                    def _send(cid):
                        try:
                            apigw_client.post_to_connection(ConnectionId=cid, Data=msg_str.encode('utf-8'))
                            return None
                        except Exception:
                            return cid
                            
                    # Fire all WS posts in parallel instead of sequentially
                    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                        results = list(executor.map(_send, conns))
                        dead = [r for r in results if r]
                        
                    if dead:
                        cache.client.srem(f"ws:evt:{event_id}", *dead)
                except Exception as e:
                    print("Boto3 WS Error:", e)
        else:
            # Local Dev FastAPI Broadcast
            if event_id in self.active_connections:
                for connection in list(self.active_connections[event_id]):
                    try:
                        await connection.send_json(message)
                    except Exception:
                        if connection in self.active_connections.get(event_id, []):
                            self.active_connections[event_id].remove(connection)

    def register_dashboard(self, websocket: WebSocket):
        self.dashboard_connections.append(websocket)

    def disconnect_dashboard(self, websocket: WebSocket):
        if websocket in self.dashboard_connections:
            self.dashboard_connections.remove(websocket)

    async def broadcast_dashboard_update(self):
        if os.getenv("ENVIRONMENT") == "production" and cache and cache.client:
            # Serverless AWS API Gateway Broadcast
            conns = cache.client.smembers("ws:dash")
            if conns:
                try:
                    global apigw_client
                    if apigw_client is None:
                        endpoint = os.getenv("WEBSOCKET_URL", "").replace("wss://", "https://")
                        apigw_client = boto3.client('apigatewaymanagementapi', endpoint_url=endpoint)
                    msg_str = json.dumps({"type": "DASHBOARD_UPDATE"})

                    def _send_dash(cid):
                        try:
                            apigw_client.post_to_connection(ConnectionId=cid, Data=msg_str.encode('utf-8'))
                            return None
                        except Exception:
                            return cid

                    # Fire all dashboard WS posts in parallel (same pattern as broadcast_change)
                    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                        results = list(executor.map(_send_dash, conns))
                        dead = [r for r in results if r]

                    if dead:
                        cache.client.srem("ws:dash", *dead)
                except Exception as e:
                    print("Boto3 WS Dash Error:", e)
        else:
            # Local Dev FastAPI Broadcast
            for connection in list(self.dashboard_connections):
                try:
                    await connection.send_json({"type": "DASHBOARD_UPDATE"})
                except Exception:
                    if connection in self.dashboard_connections:
                        self.dashboard_connections.remove(connection)


manager = ConnectionManager()
