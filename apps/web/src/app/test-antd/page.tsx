"use client";

import { AntdConfigProvider } from "@/lib/antd-config";
import { AntdCycleForm } from "@/components/academic/AntdCycleForm";
import { AntdProgrammeForm } from "@/components/academic/AntdProgrammeForm";
import { Card, Typography, Space, Divider } from "antd";
import { ExperimentOutlined, BookOutlined } from "@ant-design/icons";

const { Title, Paragraph } = Typography;

export default function TestAntdPage() {
  const handleCycleSubmit = async (data: any) => {
    console.log("Cycle data:", data);
    // Simulation d'une soumission
    await new Promise(resolve => setTimeout(resolve, 1000));
  };

  const handleProgrammeSubmit = async (data: any) => {
    console.log("Programme data:", data);
    // Simulation d'une soumission
    await new Promise(resolve => setTimeout(resolve, 1000));
  };

  return (
    <AntdConfigProvider>
      <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
        <Title level={2} style={{ textAlign: 'center', marginBottom: '32px' }}>
          Test des Composants Ant Design
        </Title>
        
        <Paragraph style={{ textAlign: 'center', fontSize: '16px', marginBottom: '32px' }}>
          Démonstration des formulaires avec Ant Design pour les cycles et programmes académiques
        </Paragraph>

        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Card 
            title={
              <Space>
                <ExperimentOutlined />
                <span>Formulaire de Cycle avec Ant Design</span>
              </Space>
            }
            style={{ marginBottom: '24px' }}
          >
            <AntdCycleForm
              onSubmit={handleCycleSubmit}
              onCancel={() => console.log("Cancel cycle")}
              isLoading={false}
            />
          </Card>

          <Divider />

          <Card 
            title={
              <Space>
                <BookOutlined />
                <span>Formulaire de Programme avec Ant Design</span>
              </Space>
            }
          >
            <AntdProgrammeForm
              onSubmit={handleProgrammeSubmit}
              onCancel={() => console.log("Cancel programme")}
              isLoading={false}
            />
          </Card>
        </Space>
      </div>
    </AntdConfigProvider>
  );
}
