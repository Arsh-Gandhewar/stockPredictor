'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Monitor, RefreshCcw, Bell } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight text-foreground">Settings</h2>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="bg-background/50 backdrop-blur-sm border-muted">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Monitor className="mr-2 h-5 w-5" />
              Display Preferences
            </CardTitle>
            <CardDescription>Manage how the app looks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Theme</span>
              <Button variant="outline" size="sm" disabled>Toggle Theme</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-background/50 backdrop-blur-sm border-muted">
          <CardHeader>
            <CardTitle className="flex items-center">
              <RefreshCcw className="mr-2 h-5 w-5" />
              Data & Refresh
            </CardTitle>
            <CardDescription>Configure market data settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Refresh Interval</span>
              <span className="text-sm text-muted-foreground">Real-time</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-background/50 backdrop-blur-sm border-muted">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Bell className="mr-2 h-5 w-5" />
              Notifications
            </CardTitle>
            <CardDescription>Manage your alerts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Price Alerts</span>
              <span className="text-sm text-muted-foreground">Enabled</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
