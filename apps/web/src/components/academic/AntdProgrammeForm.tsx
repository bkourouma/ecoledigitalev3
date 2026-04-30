"use client";

import {
  Form,
  Input,
  Select,
  Button,
  Card,
  Typography,
  Space,
  message,
} from "antd";
import { SaveOutlined, CloseOutlined } from "@ant-design/icons";
import { Programme, CreateProgramme, UpdateProgramme } from "@/lib/hooks/use-programmes";
import { useCycles } from "@/lib/hooks/use-cycles";

const { Title } = Typography;
const { Option } = Select;
const { TextArea } = Input;

interface AntdProgrammeFormProps {
  programme?: Programme;
  onSubmit: (data: CreateProgramme | UpdateProgramme) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export function AntdProgrammeForm({ programme, onSubmit, onCancel, isLoading }: AntdProgrammeFormProps) {
  const [form] = Form.useForm();
  const { data: cyclesData } = useCycles();
  const cycles = cyclesData?.data || [];

  const handleSubmit = async (values: any) => {
    try {
      const dataToSubmit = programme ? values : { ...values, status: "active" as const };
      await onSubmit(dataToSubmit);
      message.success(programme ? "Programme modifie avec succes" : "Programme cree avec succes");
    } catch (error: any) {
      console.error("Erreur lors de la soumission:", error);
      if (error.errors) {
        error.errors.forEach((err: any) => {
          form.setFields([
            {
              name: err.path[0],
              errors: [err.message],
            },
          ]);
        });
      } else {
        message.error("Erreur lors de l'enregistrement");
      }
    }
  };

  return (
    <Card
      title={
        <Title level={4} style={{ margin: 0 }}>
          {programme ? "Modifier le programme" : "Nouveau programme"}
        </Title>
      }
      style={{ maxWidth: 800, margin: "0 auto" }}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{
          name: programme?.name || "",
          code: programme?.code || "",
          description: programme?.description || "",
          cycleId: programme?.cycleId || "",
        }}
        requiredMark={false}
      >
        <Form.Item
          label="Nom du programme"
          name="name"
          rules={[
            { required: true, message: "Le nom du programme est requis" },
            { max: 100, message: "Le nom ne peut pas depasser 100 caracteres" },
          ]}
        >
          <Input placeholder="Ex: SLAM - Solutions Logicielles" size="large" />
        </Form.Item>

        <Form.Item
          label="Code"
          name="code"
          rules={[
            { required: true, message: "Le code est requis" },
            { max: 20, message: "Le code ne peut pas depasser 20 caracteres" },
          ]}
        >
          <Input placeholder="Ex: SLAM" size="large" />
        </Form.Item>

        <Form.Item
          label="Cycle"
          name="cycleId"
          rules={[
            { required: true, message: "Le cycle est requis" },
            {
              validator: (_, value) => {
                if (value === "no-cycles") {
                  return Promise.reject(new Error("Veuillez selectionner un cycle valide"));
                }
                return Promise.resolve();
              },
            },
          ]}
        >
          <Select
            size="large"
            placeholder="Selectionner un cycle"
            showSearch
            filterOption={(input, option) =>
              String(option?.children || "").toLowerCase().includes(input.toLowerCase())
            }
          >
            {cycles.length > 0 ? (
              cycles.map((cycle) => (
                <Option key={cycle.id} value={cycle.id}>
                  {cycle.name}
                </Option>
              ))
            ) : (
              <Option value="no-cycles" disabled>
                Aucun cycle disponible
              </Option>
            )}
          </Select>
        </Form.Item>

        <Form.Item label="Description" name="description">
          <TextArea placeholder="Description du programme..." rows={4} size="large" />
        </Form.Item>

        <Form.Item style={{ marginBottom: 0, marginTop: 24 }}>
          <Space style={{ width: "100%", justifyContent: "flex-end" }}>
            <Button onClick={onCancel} size="large" icon={<CloseOutlined />}>
              Annuler
            </Button>
            <Button type="primary" htmlType="submit" loading={isLoading} size="large" icon={<SaveOutlined />}>
              {isLoading ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Card>
  );
}
